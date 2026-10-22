import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PARTIAL_MESSAGES } from "../../src/api/messages.js";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { GitHubError } from "../../src/github/client.js";
import { LlmError, ZERO_USAGE } from "../../src/llm/client.js";
import { LLM_RETRY_AFTER_SEC, runAnalysis } from "../../src/pipeline/run-analysis.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { FakeLlmClient, type FakeLlmStep } from "../support/fake-llm.js";
import { FIXTURE_FILES, FIXTURE_SHA, fakeGithubRepo } from "../support/fake-repo.js";
import { createPgliteDb } from "../support/pglite-db.js";

// 엣지 케이스 (T034, spec Edge Cases, FR-013, FR-017, FR-028).

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

const decide = (output: Record<string, unknown> = {}) => ({
  data: { fileNotes: [], coverage: [], sufficient: false, requests: [], expandDirectories: [], ...output },
});
const ask = (...paths: string[]) => decide({ requests: paths.map((path) => ({ path, reason: `${path} 필요` })) });
const extras = { glossary: [], prerequisites: [], contextSummary: "", relatedFiles: [], promptExamples: [], checklist: [] };
const write = (sections: unknown[] = []): FakeLlmStep => ({ data: { title: "t", overview: "o", sections, levelExtras: extras, limitations: [] } });
const runCommands = { sectionId: "run_commands", status: "found", blocks: [{ type: "text", markdown: "npm run dev", kind: "fact", evidence: [{ path: "package.json", startLine: 3, endLine: 5 }] }] };

async function run(options: {
  github?: ReturnType<typeof fakeGithubRepo>;
  decide?: FakeLlmStep[];
  write?: FakeLlmStep[];
  limits?: Record<string, string>;
  requestedRef?: string | null;
  now?: () => Date;
}) {
  const github = options.github ?? fakeGithubRepo();
  const analysis = await repos.analyses.create(
    newAnalysisInput({ repoOwner: "acme", repoName: "demo", requestedRef: options.requestedRef ?? null, limits: parseLimits(options.limits ?? {}) }),
  );
  const llm = new FakeLlmClient({ decide: options.decide ?? [], write: options.write ?? [] });
  await runAnalysis(analysis, new AbortController().signal, {
    repos,
    llm,
    github: () => github.github,
    models: { decide: "gemini-3.5-flash-lite", write: "gemini-3.8-flash" },
    now: options.now,
  });
  return {
    row: (await repos.analyses.getById(analysis.id))!,
    manual: (await repos.manuals.getByAnalysisId(analysis.id))?.document,
    explored: await repos.files.listExploredFiles(analysis.id),
    llm,
    github,
  };
}

describe("runAnalysis edge cases", () => {
  it("marks a truncated tree as partial(repo_too_large) and says so in the manual", async () => {
    const { row, manual } = await run({
      github: fakeGithubRepo({ truncated: true }),
      decide: [decide({ sufficient: true })],
      write: [write([runCommands])],
    });
    expect(row).toMatchObject({ status: "partial", partialReasons: ["repo_too_large"] });
    expect(manual!.limitations[0]).toBe(PARTIAL_MESSAGES.repo_too_large);
  });

  it("prioritizes the URL sub-path: its README and manifest are seeds and Decide is told", async () => {
    const files = {
      ...FIXTURE_FILES,
      "packages/web/README.md": "# Web\n",
      "packages/web/package.json": '{ "name": "web" }\n',
    };
    const { row, explored, llm } = await run({
      github: fakeGithubRepo({ files }),
      requestedRef: "main/packages/web",
      decide: [decide({ sufficient: true })],
      write: [write([runCommands])],
    });
    expect(row.subpath).toBe("packages/web");
    expect(explored.filter((f) => f.source === "seed").map((f) => [f.path, f.reason])).toEqual(
      expect.arrayContaining([
        ["packages/web/README.md", "subpath-readme"],
        ["packages/web/package.json", "subpath-manifest:package.json"],
      ]),
    );
    expect(llm.calls[0]!.input).toContain("우선 탐색 경로: packages/web");
  });

  it("fails with repo_not_found_or_private when the repository disappears during analysis", async () => {
    const { row } = await run({
      github: fakeGithubRepo({ repoGoneAfterFileReads: 4 }),
      decide: [ask("src/server.ts")],
    });
    expect(row).toMatchObject({ status: "failed", failureCode: "repo_not_found_or_private" });
  });

  it("stops exploring at the time reserve and still writes a partial manual (timeout)", async () => {
    let clock = Date.parse("2026-10-22T03:00:00Z");
    const slowDecide: FakeLlmStep = () => {
      clock += 400_000; // 실행 상한 600초 중 탐색 몫(300초)을 넘긴다
      return ask("src/server.ts");
    };
    const { row, manual, llm } = await run({
      now: () => new Date(clock),
      decide: [slowDecide],
      write: [write([runCommands])],
    });
    expect(row).toMatchObject({ status: "partial", stopReason: "timeout", partialReasons: ["timeout"] });
    expect(llm.remaining("decide")).toBe(0);
    expect(manual!.limitations).toContain(PARTIAL_MESSAGES.timeout);
  });

  it("stores a retry time when GitHub rate-limits in the middle of a run", async () => {
    const before = Date.now();
    const { row } = await run({
      github: fakeGithubRepo({ failFileReadsAfter: { count: 4, error: new GitHubError("github_rate_limited", { status: 403, retryAfterSec: 300 }) } }),
      decide: [ask("src/server.ts")],
    });
    expect(row).toMatchObject({ status: "failed", failureCode: "github_rate_limited" });
    expect(row.failureRetryAt!.getTime()).toBeGreaterThanOrEqual(before + 300_000);
  });

  it("stores a retry time for Gemini rate limits and maps outages to llm_unavailable", async () => {
    const before = Date.now();
    const limited = await run({ decide: [{ error: new LlmError("llm_rate_limited", ZERO_USAGE) }] });
    expect(limited.row).toMatchObject({ status: "failed", failureCode: "llm_rate_limited" });
    expect(limited.row.failureRetryAt!.getTime()).toBeGreaterThanOrEqual(before + LLM_RETRY_AFTER_SEC * 1000);

    const down = await run({ decide: [decide({ sufficient: true })], write: [{ error: new LlmError("llm_unavailable", ZERO_USAGE) }] });
    expect(down.row).toMatchObject({ status: "failed", failureCode: "llm_unavailable", failureRetryAt: null });
  });

  it("completes a documentation-only repository with inapplicable sections as not_found", async () => {
    const docs = { "README.md": "# Handbook\n", "docs/guide.md": "# Guide\n\n본문\n", "docs/faq.md": "# FAQ\n" };
    const { row, manual } = await run({
      github: fakeGithubRepo({ files: docs }),
      decide: [ask("docs/guide.md"), decide({ sufficient: true })],
      write: [write([{ sectionId: "environment", status: "found", blocks: [{ type: "text", markdown: "문서 저장소", kind: "fact", evidence: [{ path: "docs/guide.md", startLine: 1, endLine: 1 }] }] }])],
    });
    expect(row.status).toBe("completed");
    expect(manual!.sections.filter((s) => s.status === "not_found").map((s) => s.id)).toEqual([
      "dependencies",
      "install_steps",
      "configuration",
      "run_commands",
      "verification",
    ]);
  });

  it("reads the target of a symlinked root README as the seed (monorepo)", async () => {
    const { "README.md": _rootReadme, ...withoutReadme } = FIXTURE_FILES;
    const files = { ...withoutReadme, "packages/core/README.md": "# Core\n\n실제 소개\n" };
    const { explored, github } = await run({
      github: fakeGithubRepo({ files, symlinks: { "readme.md": "packages/core/README.md" } }),
      decide: [decide({ sufficient: true })],
      write: [write([runCommands])],
    });
    expect(explored.find((f) => f.reason === "readme(symlink)")?.path).toBe("packages/core/README.md");
    expect(github.calls).toContain("blob:link-readme.md");
  });

  it("keeps using the commit fixed at the start even if a new commit lands mid-analysis", async () => {
    const newer = "f".repeat(40);
    const { row, manual, github } = await run({
      github: fakeGithubRepo({ commitShas: [FIXTURE_SHA, newer] }),
      decide: [ask("src/server.ts"), decide({ sufficient: true })],
      write: [write([runCommands])],
    });
    expect(row.status).toBe("completed");
    expect(github.fileReads.length).toBeGreaterThan(0);
    expect(github.fileReads.every((read) => read.sha === FIXTURE_SHA)).toBe(true);
    expect(manual!.repo.commitSha).toBe(FIXTURE_SHA);
  });
});
