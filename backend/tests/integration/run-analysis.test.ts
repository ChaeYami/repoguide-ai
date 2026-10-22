import { ManualSchema, type Purpose } from "@repoguide/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { GitHubError } from "../../src/github/client.js";
import { RunTimeoutError } from "../../src/jobs/worker.js";
import type { WriteOutput } from "../../src/llm/schemas.js";
import { README_ONLY_LIMITATION } from "../../src/pipeline/manual-assembler.js";
import { runAnalysis } from "../../src/pipeline/run-analysis.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { FakeLlmClient, type FakeLlmStep } from "../support/fake-llm.js";
import { FIXTURE_SHA, fakeGithubRepo } from "../support/fake-repo.js";
import { createPgliteDb } from "../support/pglite-db.js";

let handle: DbHandle;
let repos: Repositories;

beforeAll(async () => {
  handle = await createPgliteDb();
  repos = createRepositories(handle.db);
}, 60_000);
afterAll(async () => handle.close());
beforeEach(async () => {
  await handle.db.execute(sql`truncate analyses, repo_snapshots cascade`);
});

const decide = (output: Record<string, unknown>) => ({
  data: { fileNotes: [], coverage: [], sufficient: false, requests: [], expandDirectories: [], ...output },
});
const ask = (...paths: string[]) => paths.map((path) => ({ path, reason: `${path} 필요` }));
const extras = { glossary: [], prerequisites: [], contextSummary: "", relatedFiles: [], promptExamples: [], checklist: [] };

function written(sections: WriteOutput["sections"]): FakeLlmStep {
  return { data: { title: "Demo 설치 매뉴얼", overview: "요약", sections, levelExtras: extras, limitations: [] } };
}

/** README가 아닌 파일만 근거로 쓴 setup 매뉴얼 */
const setupManual = written([
  { sectionId: "environment", status: "found", blocks: [{ type: "text", markdown: "Node.js가 필요합니다.", kind: "fact", evidence: [{ path: "Dockerfile", startLine: 1, endLine: 1 }] }] },
  { sectionId: "dependencies", status: "found", blocks: [{ type: "text", markdown: "express를 씁니다.", kind: "fact", evidence: [{ path: "package.json", startLine: 7, endLine: 9 }] }] },
  { sectionId: "install_steps", status: "found", blocks: [{ type: "step", stepNo: 1, markdown: "설치", kind: "fact", command: "npm install", expectedResult: "완료", troubleshooting: "Node 확인", evidence: [{ path: "package.json", startLine: 1, endLine: 3 }] }] },
  { sectionId: "configuration", status: "found", blocks: [{ type: "text", markdown: "PORT를 설정합니다.", kind: "fact", evidence: [{ path: ".env.example", startLine: 1, endLine: 1 }] }] },
  { sectionId: "run_commands", status: "found", blocks: [{ type: "text", markdown: "npm run dev", kind: "fact", evidence: [{ path: "package.json", startLine: 3, endLine: 5 }] }] },
  { sectionId: "verification", status: "found", blocks: [{ type: "text", markdown: "서버가 PORT에서 응답합니다.", kind: "fact", evidence: [{ path: "src/server.ts", startLine: 3, endLine: 3 }] }] },
]);

async function run(options: {
  decide?: FakeLlmStep[];
  write?: FakeLlmStep[];
  github?: ReturnType<typeof fakeGithubRepo>;
  limits?: Record<string, string>;
  purpose?: Purpose;
  signal?: AbortSignal;
}) {
  const github = options.github ?? fakeGithubRepo();
  const analysis = await repos.analyses.create(
    newAnalysisInput({ repoOwner: "acme", repoName: "demo", purpose: options.purpose ?? "setup", limits: parseLimits(options.limits ?? {}) }),
  );
  const llm = new FakeLlmClient({ decide: options.decide ?? [], write: options.write ?? [] });
  await runAnalysis(analysis, options.signal ?? new AbortController().signal, {
    repos,
    llm,
    github: () => github.github,
    models: { decide: "gemini-3.5-flash-lite", write: "gemini-3.8-flash" },
  });
  const row = await repos.analyses.getById(analysis.id);
  return {
    row: row!,
    manual: (await repos.manuals.getByAnalysisId(analysis.id))?.document,
    explored: await repos.files.listExploredFiles(analysis.id),
    llm,
    calls: github.calls,
  };
}

describe("runAnalysis", () => {
  it("completes, cites non-README files for a README-poor repo (FR-008) and records everything", async () => {
    const { row, manual, explored } = await run({
      decide: [decide({ requests: ask("src/server.ts", ".env.example", "Dockerfile") }), decide({ sufficient: true })],
      write: [setupManual],
    });
    expect(row).toMatchObject({ status: "completed", stage: "done", stopReason: "sufficient", failureCode: null });
    expect(row.usage.costUsd).toBeGreaterThan(0);
    expect(row.usage.rounds).toBe(1);
    expect(ManualSchema.safeParse(manual).success).toBe(true);
    const cited = new Set(manual!.sections.flatMap((s) => s.blocks.flatMap((b) => b.evidence.map((e) => e.path))));
    expect([...cited].some((path) => path !== "README.md")).toBe(true);
    expect(manual!.repo.commitSha).toBe(FIXTURE_SHA);
    expect(explored.map((f) => [f.path, f.source, f.contentIncludedInWrite])).toEqual(
      expect.arrayContaining([
        ["README.md", "seed", true],
        ["package.json", "seed", true],
        ["src/server.ts", "llm_request", true],
      ]),
    );
    const snapshot = await repos.snapshots.getById(row.snapshotId!);
    expect(snapshot).toMatchObject({ owner: "acme", name: "demo", commitSha: FIXTURE_SHA, ref: "main" });
    expect(snapshot!.detectedStack.frameworkHints).toContain("Express");
  });

  it("is partial when the round limit stopped exploration and some sections are missing", async () => {
    const { row, manual } = await run({
      limits: { LIMIT_MAX_ROUNDS: "1" },
      decide: [decide({ requests: ask("src/server.ts"), coverage: [{ sectionId: "environment", status: "missing", note: "" }] })],
      write: [written([{ sectionId: "run_commands", status: "found", blocks: [{ type: "text", markdown: "npm run dev", kind: "fact", evidence: [{ path: "package.json", startLine: 3, endLine: 5 }] }] }])],
    });
    expect(row).toMatchObject({ status: "partial", stopReason: "round_limit", partialReasons: ["round_limit"] });
    expect(manual!.limitations[0]).toContain("탐색 라운드 한도");
  });

  it("is completed when sections are missing only because the repository lacks them", async () => {
    const { row, manual } = await run({
      decide: [decide({ requests: ask("src/server.ts") }), decide({ sufficient: true })],
      write: [written([{ sectionId: "run_commands", status: "found", blocks: [{ type: "text", markdown: "npm run dev", kind: "fact", evidence: [{ path: "package.json", startLine: 3, endLine: 5 }] }] }])],
    });
    expect(row.status).toBe("completed");
    expect(manual!.sections.filter((s) => s.status === "not_found")).toHaveLength(5);
  });

  it("marks a README-only repository with the fixed limitation and stays completed", async () => {
    const { row, manual } = await run({
      github: fakeGithubRepo({ files: { "README.md": "# Only readme\n\n설명\n" } }),
      decide: [decide({}), decide({})],
      write: [written([{ sectionId: "environment", status: "found", blocks: [{ type: "text", markdown: "설명", kind: "fact", evidence: [{ path: "README.md", startLine: 1, endLine: 1 }] }] }])],
    });
    expect(row).toMatchObject({ status: "completed", stopReason: "no_more_candidates" });
    expect(manual!.limitations[0]).toBe(README_ONLY_LIMITATION);
  });

  it.each([
    ["getRepo", new GitHubError("repo_not_found_or_private", { status: 404 }), "repo_not_found_or_private"],
    ["getCommitSha", new GitHubError("repo_empty", { status: 409 }), "repo_empty"],
  ] as const)("fails with %s → %s", async (method, error, code) => {
    const { row, llm } = await run({ github: fakeGithubRepo({ errors: { [method]: error } }) });
    expect(row).toMatchObject({ status: "failed", failureCode: code, stage: "done" });
    expect(llm.calls).toHaveLength(0);
  });

  it("stores a retry time for GitHub rate limits", async () => {
    const { row } = await run({ github: fakeGithubRepo({ errors: { getTree: new GitHubError("github_rate_limited", { retryAfterSec: 600 }) } }) });
    expect(row).toMatchObject({ status: "failed", failureCode: "github_rate_limited" });
    expect(row.failureRetryAt!.getTime()).toBeGreaterThan(Date.now() + 500_000);
  });

  it("fails with no_analyzable_files when the tree has nothing readable", async () => {
    const { row } = await run({ github: fakeGithubRepo({ files: {}, extraTree: [{ path: "logo.png", type: "blob", size: 100 }] }) });
    expect(row).toMatchObject({ status: "failed", failureCode: "no_analyzable_files" });
  });

  it("fails with manual_generation_failed when Write never matches the schema", async () => {
    const { row, manual } = await run({
      decide: [decide({ sufficient: true })],
      write: [{ data: { title: 1 } }],
    });
    expect(row).toMatchObject({ status: "failed", failureCode: "manual_generation_failed" });
    expect(manual).toBeUndefined();
    expect(row.usage.costUsd).toBeGreaterThan(0);
  });

  it("reuses the snapshot and cached seed files for the same commit", async () => {
    await run({ decide: [decide({ sufficient: true })], write: [setupManual] });
    const second = await run({ decide: [decide({ sufficient: true })], write: [setupManual] });
    expect(second.calls.filter((call) => call.startsWith("file:"))).toEqual([]);
    expect(second.row.status).toBe("completed");
  });

  it("fails with timeout when the run is aborted", async () => {
    const controller = new AbortController();
    controller.abort(new RunTimeoutError());
    const { row } = await run({ signal: controller.signal });
    expect(row).toMatchObject({ status: "failed", failureCode: "timeout" });
  });
});
