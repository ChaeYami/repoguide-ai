import { TraceResponseSchema } from "@repoguide/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerAnalysesRoutes } from "../../src/api/routes/analyses.js";
import { buildServer } from "../../src/api/server.js";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { runAnalysis } from "../../src/pipeline/run-analysis.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { FakeLlmClient } from "../support/fake-llm.js";
import { FIXTURE_SHA, fakeGithubRepo, fixtureCandidates } from "../support/fake-repo.js";
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

async function getTrace(id: string) {
  const app = await buildServer({
    db: handle,
    logger: false,
    routes: (instance) => registerAnalysesRoutes(instance, { repos, limits: parseLimits({}), retentionDays: 30, clientKeySalt: "s".repeat(40) }),
  });
  return app.inject({ method: "GET", url: `/api/analyses/${id}/trace` });
}

const decide = (output: Record<string, unknown>) => ({
  data: { fileNotes: [], coverage: [], sufficient: false, requests: [], expandDirectories: [], ...output },
});
const emptyExtras = { glossary: [], prerequisites: [], contextSummary: "", relatedFiles: [], promptExamples: [], checklist: [] };

describe("GET /api/analyses/:id/trace", () => {
  it("returns decisions, rejections and the working set with commit-pinned links for a finished analysis", async () => {
    const analysis = await repos.analyses.create(newAnalysisInput({ repoOwner: "acme", repoName: "demo" }));
    const llm = new FakeLlmClient({
      decide: [
        decide({ requests: [{ path: "src/server.ts", reason: "서버 진입점" }, { path: "src/nope.ts", reason: "없는 파일" }] }),
        decide({ sufficient: true, coverage: [{ sectionId: "run_commands", status: "covered", note: "scripts" }] }),
      ],
      write: [{ data: { title: "t", overview: "o", sections: [], levelExtras: emptyExtras, limitations: [] } }],
    });
    await runAnalysis(analysis, new AbortController().signal, {
      repos,
      llm,
      github: () => fakeGithubRepo().github,
      models: { decide: "gemini-3.5-flash-lite", write: "gemini-3.8-flash" },
    });

    const res = await getTrace(analysis.id);
    expect(res.statusCode).toBe(200);
    const trace = TraceResponseSchema.parse(res.json());
    expect(trace.repo).toMatchObject({ owner: "acme", name: "demo", commitSha: FIXTURE_SHA, ref: "main" });
    expect(trace.treeStats).toEqual({ entryCount: expect.any(Number), candidateCount: fixtureCandidates().length, truncated: false });
    expect(trace.detectedStack.frameworkHints).toContain("Express");
    expect(trace.stopReason).toBe("sufficient");
    expect(trace.limitReached).toBe(false);
    expect(trace.limits.maxRounds).toBe(3);
    expect(trace.usage.costUsd).toBeGreaterThan(0);
    expect(trace.decisions.map((d) => [d.decideNo, d.sufficient])).toEqual([[1, false], [2, true]]);
    expect(trace.decisions[0]!.requests).toEqual([
      { path: "src/server.ts", reason: "서버 진입점", accepted: true, rejectReason: null },
      { path: "src/nope.ts", reason: "없는 파일", accepted: false, rejectReason: "not_in_tree" },
    ]);
    const server = trace.files.find((f) => f.path === "src/server.ts")!;
    expect(server).toMatchObject({ roundNo: 1, source: "llm_request", reason: "서버 진입점", truncated: false, contentIncludedInWrite: true });
    expect(server.sizeBytes).toBeGreaterThan(0);
    expect(server.githubUrl).toBe(`https://github.com/acme/demo/blob/${FIXTURE_SHA}/src/server.ts`);
    expect(trace.files.filter((f) => f.source === "seed").map((f) => f.path).sort()).toEqual([".env.example", "Dockerfile", "README.md", "package.json"]);
  });

  it("returns what is recorded so far while the analysis is still running", async () => {
    const analysis = await repos.analyses.create(newAnalysisInput());
    const empty = TraceResponseSchema.parse((await getTrace(analysis.id)).json());
    expect(empty).toMatchObject({ decisions: [], files: [], stopReason: null, limitReached: false, treeStats: { entryCount: 0 } });

    const snapshot = await repos.snapshots.upsert({
      owner: "acme", name: "app", commitSha: FIXTURE_SHA, ref: "main", defaultBranch: "main", description: null,
      primaryLanguage: null, treeEntryCount: 9, candidateCount: 9, treeTruncated: false, candidates: fixtureCandidates(),
      detectedStack: { languages: ["TypeScript"], packageManagers: [], frameworkHints: [], manifests: [] },
    });
    await repos.analyses.attachSnapshot(analysis.id, snapshot.id, null);
    const file = await repos.files.upsertSnapshotFile({
      snapshotId: snapshot.id, path: "README.md", blobSha: "b", sizeBytes: 30, content: "# x\n", lineCount: 1, truncated: false, skippedReason: null,
    });
    await repos.files.addExploredFile({ analysisId: analysis.id, snapshotFileId: file.id, path: "README.md", roundNo: 1, source: "seed", reason: "readme" });

    const partial = TraceResponseSchema.parse((await getTrace(analysis.id)).json());
    expect(partial.files.map((f) => [f.path, f.contentIncludedInWrite])).toEqual([["README.md", false]]);
    expect(partial.decisions).toEqual([]);
    expect(partial.repo.commitSha).toBe(FIXTURE_SHA);
  });

  it("reports limitReached when exploration stopped on a limit", async () => {
    const analysis = await repos.analyses.create(newAnalysisInput());
    await repos.analyses.finish(analysis.id, {
      status: "partial", stopReason: "file_limit", partialReasons: ["file_limit"],
      usage: { rounds: 1, filesRead: 40, githubCalls: 44, inputTokens: 1, outputTokens: 1, thoughtTokens: 0, costUsd: 0.01, usageEstimated: false },
    });
    expect(TraceResponseSchema.parse((await getTrace(analysis.id)).json()).limitReached).toBe(true);
  });

  it("returns 404 for unknown analyses", async () => {
    const res = await getTrace("11111111-1111-4111-8111-111111111111");
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });
});
