// npm run dev:analyze -- <GitHub URL> [--level beginner|vibe_coder|developer] [--purpose understand|setup|modify]
// 실제 GitHub·Gemini·DB로 분석 한 건을 끝까지 실행하고 요약을 출력한다 (연결 지점 ④). 워커를 거치지 않는다.
import { LevelSchema, parseRepoUrl, PurposeSchema } from "@repoguide/shared";
import { EnvError, loadConfig } from "../src/config/env.js";
import { priceFor } from "../src/config/pricing.js";
import { createPostgresDb } from "../src/db/client.js";
import { createRepositories } from "../src/db/repositories/index.js";
import { GitHubClient } from "../src/github/client.js";
import { GeminiClient } from "../src/llm/gemini-client.js";
import { analysisFromUrl } from "../src/pipeline/new-analysis.js";
import { runAnalysis } from "../src/pipeline/run-analysis.js";

function option(name: string, fallback: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

async function main() {
  const url = process.argv.slice(2).find((arg, i, all) => !arg.startsWith("--") && !all[i - 1]?.startsWith("--"));
  const parsed = url ? parseRepoUrl(url) : null;
  if (!parsed?.ok) {
    console.error(parsed ? `✘ ${parsed.error.message}` : "사용법: npm run dev:analyze -- <GitHub URL> [--level beginner] [--purpose setup]");
    process.exitCode = 2;
    return;
  }
  const level = LevelSchema.parse(option("level", "beginner"));
  const purpose = PurposeSchema.parse(option("purpose", "setup"));

  const { env, limits } = loadConfig({ require: ["DATABASE_URL", "GEMINI_API_KEY"] });
  priceFor(env.GEMINI_MODEL_DECIDE);
  priceFor(env.GEMINI_MODEL_WRITE);
  if (!env.GITHUB_TOKEN) console.warn("⚠ GITHUB_TOKEN이 없어 GitHub 한도가 시간당 60회입니다.");

  const db = createPostgresDb(env.DATABASE_URL!, { max: 3 });
  const repos = createRepositories(db.db);
  const llm = new GeminiClient({ apiKey: env.GEMINI_API_KEY! });
  const created = await repos.analyses.create(
    analysisFromUrl(parsed.value, { level, purpose, limits, clientKeyHash: "dev-analyze", retentionDays: env.RETENTION_DAYS }),
  );
  // 같은 DB를 쓰는 서버가 떠 있어도 그 워커가 이 분석을 가져가지 않도록 직접 맡는다.
  const analysis = (await repos.analyses.claimById(created.id, "dev-analyze", limits.runTimeoutSec * 2000))!;
  console.log(`분석 ${analysis.id} 시작 — ${parsed.value.owner}/${parsed.value.name} · ${level} · ${purpose}\n`);

  const started = Date.now();
  let last = "";
  const ticker = setInterval(async () => {
    const row = await repos.analyses.getById(analysis.id);
    if (!row) return;
    const line = `${row.stage}${row.progress.activity ? ` / ${row.progress.activity}` : ""} · 라운드 ${row.progress.round}/${row.progress.maxRounds} · 파일 ${row.progress.filesRead}`;
    if (line !== last) console.log(`  [${((Date.now() - started) / 1000).toFixed(0).padStart(3)}s] ${line}`);
    last = line;
  }, 3_000);

  try {
    await runAnalysis(analysis, new AbortController().signal, {
      repos,
      llm,
      github: (onCall) => new GitHubClient({ token: env.GITHUB_TOKEN, onCall }),
      models: { decide: env.GEMINI_MODEL_DECIDE, write: env.GEMINI_MODEL_WRITE },
      logger: { info: () => {}, warn: (obj) => console.warn("  ⚠", (obj as { err?: Error }).err?.message ?? ""), error: (obj) => console.error("  ✘", (obj as { err?: Error }).err ?? "") },
    });
  } finally {
    clearInterval(ticker);
  }

  const row = (await repos.analyses.getById(analysis.id))!;
  const rounds = await repos.rounds.listByAnalysis(analysis.id);
  const explored = await repos.files.listExploredFiles(analysis.id);
  const manual = await repos.manuals.getByAnalysisId(analysis.id);
  const u = row.usage;

  console.log(`\n결과        ${row.status}${row.failureCode ? ` (${row.failureCode})` : ""}${row.partialReasons.length ? ` — ${row.partialReasons.join(", ")}` : ""}`);
  console.log(`종료 사유   ${row.stopReason ?? "-"}`);
  console.log(`소요        ${((Date.now() - started) / 1000).toFixed(1)}초`);
  console.log(`사용량      라운드 ${u.rounds} · 파일 ${u.filesRead} · GitHub ${u.githubCalls}회 · 토큰 입력 ${u.inputTokens}/출력 ${u.outputTokens}/사고 ${u.thoughtTokens} · $${u.costUsd.toFixed(4)}`);
  console.log("\n탐색 판단");
  for (const round of rounds) {
    const accepted = round.requests.filter((r) => r.accepted).map((r) => r.path);
    const rejected = round.requests.filter((r) => !r.accepted).map((r) => `${r.path}(${r.rejectReason})`);
    console.log(`  #${round.decideNo} sufficient=${round.sufficient} 수락 ${accepted.length}: ${accepted.join(", ") || "-"}${rejected.length ? ` | 거절: ${rejected.join(", ")}` : ""}`);
  }
  console.log(`\n작업 집합 (${explored.length}개)`);
  for (const file of explored) console.log(`  r${file.roundNo} ${file.source.padEnd(11)} ${file.contentIncludedInWrite ? "원문" : "노트"}  ${file.path}  — ${file.reason}`);
  if (manual) {
    const doc = manual.document;
    console.log(`\n매뉴얼      ${doc.title}`);
    for (const section of doc.sections) {
      const facts = section.blocks.filter((b) => b.kind === "fact").length;
      console.log(`  ${section.status.padEnd(9)} ${section.title} — 블록 ${section.blocks.length} (확인됨 ${facts})`);
    }
    console.log(`  근거 유지 ${manual.stats.evidenceKept} · 제거 ${manual.stats.evidenceDropped} · 강등 ${manual.stats.downgraded}`);
    if (doc.limitations.length) console.log(`  한계: ${doc.limitations.join(" / ")}`);
  }
  console.log(`\n화면에서 보기: http://localhost:5173/a/${analysis.id}  (npm run dev 실행 중일 때)`);
  await db.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof EnvError ? error.message : error);
  process.exitCode = 1;
});
