// npm run blind-kit -- <완료된 분석 ID> [<ID> ...]
// 수준별 블라인드 판별 키트를 만든다 (T049, SC-005). 분석마다 나머지 두 수준을 "수준 변경 재생성"으로 만들고
// (부모가 읽은 파일을 재사용해 저렴하다), 수준 표시를 지운 매뉴얼·정답표·평가 양식을 저장한다.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Level, LevelSchema, type Manual } from "@repoguide/shared";
import { EnvError, loadConfig } from "../src/config/env.js";
import { createPostgresDb } from "../src/db/client.js";
import type { AnalysisRow } from "../src/db/repositories/analyses.js";
import { createRepositories, type Repositories } from "../src/db/repositories/index.js";
import { GitHubClient } from "../src/github/client.js";
import { GeminiClient } from "../src/llm/gemini-client.js";
import { PROMPT_VERSION } from "../src/llm/prompts/file-block.js";
import { runAnalysis, type RunDeps } from "../src/pipeline/run-analysis.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT_DIR = join(HERE, "../../specs/001-repo-manual-generator/eval/blind-kit");
const LEVELS = LevelSchema.options;

/** 판별 단서가 되는 수준 이름·메타 정보를 빼고 본문만 마크다운으로 옮긴다. */
export function manualToBlindMarkdown(manual: Manual, label: string): string {
  const out = [`# ${label}`, "", manual.overview, ""];
  const extras = manual.levelExtras;
  if (extras.level === "beginner") {
    if (extras.prerequisites.length) out.push("## 시작하기 전에", ...extras.prerequisites.map((p) => `- **${p.topic}** — ${p.explanation}`), "");
    if (extras.glossary.length) out.push("## 용어", ...extras.glossary.map((g) => `- **${g.term}** — ${g.explanation}`), "");
  }
  if (extras.level === "vibe_coder") {
    if (extras.contextSummary) out.push("## 맥락 요약", extras.contextSummary, "");
    if (extras.relatedFiles.length) out.push("## 관련 파일", ...extras.relatedFiles.map((f) => `- \`${f.path}\` — ${f.why}`), "");
    if (extras.promptExamples.length) out.push("## 요청 예시", ...extras.promptExamples.map((p) => `- **${p.title}**: ${p.prompt}`), "");
    if (extras.checklist.length) out.push("## 확인할 것", ...extras.checklist.map((c) => `- ${c}`), "");
  }
  for (const section of manual.sections) {
    out.push(`## ${section.title}`, "");
    if (section.blocks.length === 0) out.push("(저장소에서 확인되지 않음)", "");
    for (const block of section.blocks) {
      const tag = block.kind === "fact" ? "[확인됨]" : "[추론]";
      out.push(`${block.type === "step" && block.stepNo !== undefined ? `${block.stepNo}. ` : ""}${tag} ${block.markdown}`);
      if (block.command) out.push("", "```", block.command, "```");
      if (block.expectedResult) out.push(`- 정상 결과: ${block.expectedResult}`);
      if (block.troubleshooting) out.push(`- 문제가 생기면: ${block.troubleshooting}`);
      if (block.evidence.length) out.push(`- 근거: ${block.evidence.map((e) => `${e.path}:${e.startLine}-${e.endLine}`).join(", ")}`);
      out.push("");
    }
  }
  return out.join("\n");
}

async function regenerateLevel(repos: Repositories, parent: AnalysisRow, level: Level, deps: Omit<RunDeps, "repos">, limits: AnalysisRow["limits"]) {
  const existing = (await repos.analyses.listByRoot(parent.rootAnalysisId)).find(
    (row) => row.level === level && row.purpose === parent.purpose && (row.status === "completed" || row.status === "partial"),
  );
  if (existing) return existing;
  const child = await repos.analyses.create({
    repoOwner: parent.repoOwner,
    repoName: parent.repoName,
    requestedRef: parent.requestedRef,
    subpath: parent.subpath,
    level,
    purpose: parent.purpose,
    limits,
    promptVersion: PROMPT_VERSION,
    clientKeyHash: "blind-kit",
    expiresAt: parent.expiresAt,
    snapshotId: parent.snapshotId,
    parentAnalysisId: parent.id,
    rootAnalysisId: parent.rootAnalysisId,
    regenerationMode: "change_options",
  });
  const claimed = (await repos.analyses.claimById(child.id, "blind-kit", limits.runTimeoutSec * 2000))!;
  await runAnalysis(claimed, new AbortController().signal, { ...deps, repos });
  return (await repos.analyses.getById(child.id))!;
}

async function main() {
  const ids = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
  if (ids.length === 0) {
    console.error("사용법: npm run blind-kit -- <완료된 분석 ID> [<ID> ...]");
    process.exitCode = 2;
    return;
  }
  const { env, limits } = loadConfig({ require: ["DATABASE_URL", "GEMINI_API_KEY", "GITHUB_TOKEN"] });
  const db = createPostgresDb(env.DATABASE_URL!, { max: 3 });
  const repos = createRepositories(db.db);
  const deps = {
    llm: new GeminiClient({ apiKey: env.GEMINI_API_KEY! }),
    github: (onCall: () => void) => new GitHubClient({ token: env.GITHUB_TOKEN, onCall }),
    models: { decide: env.GEMINI_MODEL_DECIDE, write: env.GEMINI_MODEL_WRITE },
  };

  // 샘플 순서를 섞어 수준 순서로 짐작하지 못하게 한다(재현 가능하도록 고정 시드).
  let seed = 20261022;
  const random = () => ((seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31) / 2 ** 31);
  const samples: { repo: string; level: Level; id: string; manual: Manual }[] = [];
  let cost = 0;

  for (const id of ids) {
    const parent = await repos.analyses.getById(id);
    if (!parent || (parent.status !== "completed" && parent.status !== "partial")) throw new Error(`완료된 분석이 아닙니다: ${id}`);
    for (const level of LEVELS) {
      const row = level === parent.level ? parent : await regenerateLevel(repos, parent, level, deps, limits);
      if (row.id !== parent.id) cost += row.usage.costUsd;
      const manual = await repos.manuals.getByAnalysisId(row.id);
      if (!manual) throw new Error(`매뉴얼이 없습니다: ${row.id} (${row.status} ${row.failureCode ?? ""})`);
      samples.push({ repo: `${row.repoOwner}/${row.repoName}`, level, id: row.id, manual: manual.document });
      console.log(`  ${row.repoOwner}/${row.repoName} · ${level} · ${row.purpose}: ${row.id}`);
    }
  }

  const order = samples
    .map((sample) => ({ sample, key: random() }))
    .sort((a, b) => a.key - b.key)
    .map(({ sample }, index) => ({ ...sample, file: `sample-${String.fromCharCode(97 + index)}.md`, label: `샘플 ${String.fromCharCode(65 + index)}` }));
  mkdirSync(KIT_DIR, { recursive: true });
  for (const sample of order) {
    writeFileSync(join(KIT_DIR, sample.file), manualToBlindMarkdown(sample.manual, `${sample.label} (${sample.repo})`), "utf8");
  }

  writeFileSync(
    join(KIT_DIR, "answer-key.md"),
    ["# 정답표 (평가자에게 보여 주지 않는다)", "", "| 샘플 | 저장소 | 수준 | 분석 ID |", "|---|---|---|---|", ...order.map((s) => `| ${s.file} | ${s.repo} | ${s.level} | \`${s.id}\` |`), ""].join("\n"),
    "utf8",
  );
  writeFileSync(
    join(KIT_DIR, "evaluation-form.md"),
    [
      "# 수준 판별 평가 양식 (SC-005)",
      "",
      "각 샘플 매뉴얼을 읽고, 어느 독자를 위해 쓰였는지 하나를 고르세요. 저장소마다 세 수준이 하나씩 섞여 있습니다.",
      "",
      "- **입문자**: 프로그래밍·개발 환경 사전 지식이 거의 없는 사람",
      "- **바이브 코딩 개발자**: AI 코딩 도구로 프로젝트를 이해하거나 고치려는 사람",
      "- **일반 개발자**: 코드와 구조를 직접 보고 개발하는 사람",
      "",
      "평가자 이름: ________",
      "",
      "| 샘플 | 입문자 | 바이브 코딩 | 일반 개발자 | 판단 근거(한 줄) |",
      "|---|---|---|---|---|",
      ...order.map((s) => `| ${s.file} | ☐ | ☐ | ☐ | |`),
      "",
      "기준: 평가자 2명 이상, 정답률 80% 이상.",
      "",
    ].join("\n"),
    "utf8",
  );
  console.log(`\n키트: ${KIT_DIR} (샘플 ${order.length}개, 재생성 비용 $${cost.toFixed(4)})`);
  await db.close();
}

main().catch((error: unknown) => {
  console.error(error instanceof EnvError ? error.message : error);
  process.exitCode = 1;
});
