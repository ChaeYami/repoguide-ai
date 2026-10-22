// npm run eval [-- --repos N] [-- --only <저장소 이름 일부>]
// 실제 GitHub·Gemini·DB로 평가 저장소를 분석하고 지표 리포트를 만든다 (T047). 비용이 든다.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Level, parseRepoUrl, type Purpose } from "@repoguide/shared";
import { EnvError, loadConfig } from "../src/config/env.js";
import { priceFor } from "../src/config/pricing.js";
import { createPostgresDb } from "../src/db/client.js";
import { createRepositories, type Repositories } from "../src/db/repositories/index.js";
import { GitHubClient } from "../src/github/client.js";
import { GeminiClient } from "../src/llm/gemini-client.js";
import { analysisFromUrl } from "../src/pipeline/new-analysis.js";
import { runAnalysis } from "../src/pipeline/run-analysis.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPORT_DIR = join(HERE, "../../specs/001-repo-manual-generator/eval");
const README = /(^|\/)readme(\.[a-z0-9]+)?$/i;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
// Gemini 분당 한도에 걸리지 않도록 한 번에 하나씩 분석한다(T048 1차 평가에서 동시 2건이 llm_rate_limited로 실패).
const CONCURRENCY = 1;

interface EvalRepo {
  url: string;
  note: string;
  thinReadme?: boolean;
  large?: boolean;
  keyFiles?: string[];
  runs: { level: Level; purpose: Purpose }[];
}

interface RunResult {
  repo: EvalRepo;
  level: Level;
  purpose: Purpose;
  id: string;
  status: string;
  detail: string;
  durationMs: number;
  candidateCount: number;
  costUsd: number;
  costCapUsd: number;
  rounds: number;
  workingSet: string[];
  nonReadmeCited: boolean;
  storedEvidence: number;
  storedEvidenceValid: number;
  proposedKept: number;
  proposedDropped: number;
  downgraded: number;
  stopReason: string | null;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : undefined;
}

function jaccard(a: string[], b: string[]): number {
  const left = new Set(a);
  const right = new Set(b);
  const union = new Set([...left, ...right]);
  if (union.size === 0) return 1;
  return [...left].filter((path) => right.has(path)).length / union.size;
}

async function measure(repos: Repositories, repo: EvalRepo, run: EvalRepo["runs"][number], deps: Omit<Parameters<typeof runAnalysis>[2], "repos">, env: ReturnType<typeof loadConfig>): Promise<RunResult> {
  const parsed = parseRepoUrl(repo.url);
  if (!parsed.ok) throw new Error(`잘못된 URL: ${repo.url}`);
  const created = await repos.analyses.create(
    analysisFromUrl(parsed.value, { ...run, limits: env.limits, clientKeyHash: "eval", retentionDays: env.env.RETENTION_DAYS }),
  );
  // 같은 DB를 쓰는 서버가 떠 있어도 그 워커가 이 분석을 가져가지 않도록 직접 맡는다.
  const analysis = (await repos.analyses.claimById(created.id, "eval", env.limits.runTimeoutSec * 2000))!;
  const started = Date.now();
  await runAnalysis(analysis, new AbortController().signal, { ...deps, repos });
  const durationMs = Date.now() - started;

  const row = (await repos.analyses.getById(analysis.id))!;
  const snapshot = row.snapshotId ? await repos.snapshots.getById(row.snapshotId) : null;
  const files = await repos.files.listWorkingSet(row.id);
  const manual = await repos.manuals.getByAnalysisId(row.id);
  const lines = new Map(files.map((file) => [file.path, file.lineCount]));
  const evidence = manual?.document.sections.flatMap((section) => section.blocks.flatMap((block) => block.evidence)) ?? [];
  const valid = evidence.filter((item) => {
    const lineCount = lines.get(item.path);
    return lineCount !== undefined && item.startLine >= 1 && item.endLine <= lineCount && item.url.includes(`/blob/${snapshot?.commitSha}/`);
  });
  return {
    repo,
    ...run,
    id: row.id,
    status: row.status,
    detail: row.failureCode ?? row.partialReasons.join(","),
    durationMs,
    candidateCount: snapshot?.candidateCount ?? 0,
    costUsd: row.usage.costUsd,
    costCapUsd: row.limits.maxCostUsdPerRun,
    rounds: row.usage.rounds,
    workingSet: files.map((file) => file.path),
    nonReadmeCited: evidence.some((item) => !README.test(item.path)),
    storedEvidence: evidence.length,
    storedEvidenceValid: valid.length,
    proposedKept: manual?.stats.evidenceKept ?? 0,
    proposedDropped: manual?.stats.evidenceDropped ?? 0,
    downgraded: manual?.stats.downgraded ?? 0,
    stopReason: row.stopReason,
  };
}

function report(results: RunResult[], date: string): string {
  const pct = (n: number, d: number) => (d === 0 ? "-" : `${Math.round((n / d) * 100)}%`);
  const done = results.filter((r) => r.status === "completed" || r.status === "partial");
  const normal = results.filter((r) => r.candidateCount > 0 && r.candidateCount <= 1000);
  const evidence = done.reduce((sum, r) => sum + r.storedEvidence, 0);
  const evidenceValid = done.reduce((sum, r) => sum + r.storedEvidenceValid, 0);
  const proposed = done.reduce((sum, r) => sum + r.proposedKept + r.proposedDropped, 0);

  const lines = [
    `# 평가 리포트 ${date}`,
    "",
    "`npm run eval`로 생성 (T047). 실제 GitHub·Gemini·Supabase로 분석했다.",
    "",
    "## 실행별 결과",
    "",
    "| 저장소 | 수준·목적 | 상태 | 후보 파일 | 라운드 | 읽은 파일 | 시간 | 비용 / 상한 | README 외 근거 | 근거 유효 | 강등 | 종료 사유 |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...results.map((r) =>
      [
        `${r.repo.url.replace("https://github.com/", "")}`,
        `${r.level} · ${r.purpose}`,
        `${r.status}${r.detail ? ` (${r.detail})` : ""}`,
        r.candidateCount,
        r.rounds,
        r.workingSet.length,
        `${(r.durationMs / 1000).toFixed(0)}초`,
        `$${r.costUsd.toFixed(4)} / $${r.costCapUsd.toFixed(2)}`,
        r.nonReadmeCited ? "✅" : "❌",
        `${r.storedEvidenceValid}/${r.storedEvidence}`,
        r.downgraded,
        r.stopReason ?? "-",
      ].join(" | ").replace(/^/, "| ").concat(" |"),
    ),
    "",
    "## 성공 기준 지표",
    "",
    `- **SC-001** 파일 1,000개 이하 저장소 5분 이내: ${pct(normal.filter((r) => r.durationMs <= FIVE_MINUTES_MS).length, normal.length)} (${normal.length}건, 기준 90%)`,
    `- **SC-003** 저장된 근거 유효율: ${pct(evidenceValid, evidence)} (${evidenceValid}/${evidence}, 기준 100%). 참고: AI가 제안한 근거 중 검증 통과 ${pct(done.reduce((s, r) => s + r.proposedKept, 0), proposed)}`,
    `- **SC-004** README 외 근거 포함: ${pct(done.filter((r) => r.nonReadmeCited).length, done.length)} (${done.length}건, 기준 100%)`,
    `- **SC-008** 실행당 비용 상한 준수: ${results.filter((r) => r.costUsd <= r.costCapUsd).length}/${results.length}건, 초과 ${results.filter((r) => r.costUsd > r.costCapUsd).length}건`,
    `- 부분 완료율: ${pct(results.filter((r) => r.status === "partial").length, results.length)}, 실패 ${results.filter((r) => r.status === "failed").length}건`,
    `- 총비용: $${results.reduce((sum, r) => sum + r.costUsd, 0).toFixed(4)}`,
    "",
    "## 목적별 작업 집합 차이 (FR-009)",
    "",
  ];

  const byRepo = new Map<string, RunResult[]>();
  for (const r of results) byRepo.set(r.repo.url, [...(byRepo.get(r.repo.url) ?? []), r]);
  let jaccardRows = 0;
  for (const [url, runs] of byRepo) {
    if (runs.length < 2) continue;
    const pairs: string[] = [];
    const values: number[] = [];
    for (let i = 0; i < runs.length; i += 1) {
      for (let j = i + 1; j < runs.length; j += 1) {
        const value = jaccard(runs[i]!.workingSet, runs[j]!.workingSet);
        values.push(value);
        pairs.push(`${runs[i]!.purpose}↔${runs[j]!.purpose} ${value.toFixed(2)}`);
      }
    }
    const average = values.reduce((sum, v) => sum + v, 0) / values.length;
    const candidates = Math.max(...runs.map((r) => r.candidateCount));
    lines.push(`- ${url.replace("https://github.com/", "")} (후보 ${candidates}개): ${pairs.join(", ")} → 평균 ${average.toFixed(2)}, 완전히 같은 쌍 ${values.filter((v) => v === 1).length}개 (기준: 평균 0.8 이하, 같은 쌍 0개)`);
    jaccardRows += 1;
  }
  if (jaccardRows === 0) lines.push("- (목적을 둘 이상 실행한 저장소 없음)");

  lines.push("", "## 확장 게이트 지표 (research R13)", "");
  const large = results.filter((r) => r.repo.large);
  for (const r of large) {
    const keys = r.repo.keyFiles ?? [];
    const missed = keys.filter((path) => !r.workingSet.includes(path));
    lines.push(`- ${r.repo.url.replace("https://github.com/", "")}: 핵심 파일 누락 ${pct(missed.length, keys.length)} (${missed.join(", ") || "없음"}) — 기준 20% 이상이면 검색 계열 검토`);
  }
  lines.push(`- \`round_limit\`로 부분 완료된 비율: ${pct(results.filter((r) => r.status === "partial" && r.detail.includes("round_limit")).length, results.length)} — 기준 30% 초과면 검색 계열 검토`);
  lines.push("", "## 실행 ID", "", ...results.map((r) => `- ${r.repo.url.replace("https://github.com/", "")} · ${r.level} · ${r.purpose}: \`${r.id}\``), "");
  return lines.join("\n");
}

async function main() {
  const config = loadConfig({ require: ["DATABASE_URL", "GEMINI_API_KEY", "GITHUB_TOKEN"] });
  const { env } = config;
  priceFor(env.GEMINI_MODEL_DECIDE);
  priceFor(env.GEMINI_MODEL_WRITE);

  const list = (JSON.parse(readFileSync(join(HERE, "eval-repos.json"), "utf8")) as { repos: EvalRepo[] }).repos;
  const only = option("only");
  const limit = Number(option("repos") ?? list.length);
  const repos = list.filter((repo) => !only || repo.url.includes(only)).slice(0, limit);
  const jobs = repos.flatMap((repo) => repo.runs.map((run) => ({ repo, run })));
  console.log(`평가 ${repos.length}개 저장소, ${jobs.length}회 분석 (동시 ${CONCURRENCY})`);

  const db = createPostgresDb(env.DATABASE_URL!, { max: 4 });
  const repositories = createRepositories(db.db);
  const deps = {
    llm: new GeminiClient({ apiKey: env.GEMINI_API_KEY! }),
    github: (onCall: () => void) => new GitHubClient({ token: env.GITHUB_TOKEN, onCall }),
    models: { decide: env.GEMINI_MODEL_DECIDE, write: env.GEMINI_MODEL_WRITE },
  };

  const results: RunResult[] = new Array(jobs.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < jobs.length) {
        const index = next++;
        const { repo, run } = jobs[index]!;
        const result = await measure(repositories, repo, run, deps, config);
        results[index] = result;
        console.log(`  ${result.status.padEnd(9)} ${repo.url.replace("https://github.com/", "")} · ${run.level} · ${run.purpose} — ${(result.durationMs / 1000).toFixed(0)}초, $${result.costUsd.toFixed(4)}`);
      }
    }),
  );

  const date = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  mkdirSync(REPORT_DIR, { recursive: true });
  const path = join(REPORT_DIR, `report-${date}.md`);
  writeFileSync(path, report(results, date), "utf8");
  console.log(`\n리포트: ${path}`);
  await db.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof EnvError ? error.message : error);
  process.exitCode = 1;
});
