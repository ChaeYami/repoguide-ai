import { AnalysisDetailSchema, FreshnessResponseSchema } from "@repoguide/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerAnalysesRoutes } from "../../src/api/routes/analyses.js";
import { buildServer } from "../../src/api/server.js";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { EMPTY_USAGE } from "../../src/db/repositories/analyses.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { FreshnessCache } from "../../src/github/freshness-cache.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { FIXTURE_SHA, fixtureCandidates } from "../support/fake-repo.js";
import { createPgliteDb } from "../support/pglite-db.js";

// 최신 커밋 확인(T042)과 재생성 API·버전 계보(T043).

const NEWER = "f".repeat(40);
let handle: DbHandle;
let repos: Repositories;
let latestSha = FIXTURE_SHA;
let commitCalls = 0;
let clock = new Date("2026-10-22T03:00:00Z");

beforeAll(async () => {
  handle = await createPgliteDb();
  repos = createRepositories(handle.db);
}, 60_000);
afterAll(async () => handle.close());
beforeEach(async () => {
  latestSha = FIXTURE_SHA;
  commitCalls = 0;
  clock = new Date("2026-10-22T03:00:00Z");
  await handle.db.execute(sql`truncate analyses, repo_snapshots cascade`);
});

async function app(limits: Record<string, string> = {}) {
  const freshness = new FreshnessCache(
    {
      getCommitSha: async () => {
        commitCalls += 1;
        return latestSha;
      },
    },
    { now: () => clock },
  );
  return buildServer({
    db: handle,
    logger: false,
    routes: (instance) =>
      registerAnalysesRoutes(instance, { repos, limits: parseLimits(limits), retentionDays: 30, clientKeySalt: "s".repeat(40), freshness, now: () => clock }),
  });
}

async function finished(status: "completed" | "partial" = "completed") {
  const snapshot = await repos.snapshots.upsert({
    owner: "acme", name: "app", commitSha: FIXTURE_SHA, ref: "main", defaultBranch: "main", description: null, primaryLanguage: null,
    treeEntryCount: 9, candidateCount: 9, treeTruncated: false, candidates: fixtureCandidates(),
    detectedStack: { languages: [], packageManagers: [], frameworkHints: [], manifests: [] },
  });
  const row = await repos.analyses.create(newAnalysisInput({ snapshotId: snapshot.id, level: "beginner", purpose: "setup", createdAt: new Date(clock.getTime() - 60_000) }));
  if (status === "partial") await repos.analyses.finish(row.id, { status, stopReason: "round_limit", partialReasons: ["round_limit"], usage: EMPTY_USAGE });
  else await repos.analyses.finish(row.id, { status, stopReason: "sufficient", usage: EMPTY_USAGE });
  return { row, snapshot };
}

const regenerate = async (server: Awaited<ReturnType<typeof app>>, id: string, body: unknown) =>
  server.inject({ method: "POST", url: `/api/analyses/${id}/regenerations`, payload: body as Record<string, unknown> });

describe("GET /api/analyses/:id/freshness", () => {
  it("compares the analyzed commit with the latest one and caches the result for 5 minutes", async () => {
    const { row } = await finished();
    const server = await app();
    const first = FreshnessResponseSchema.parse((await server.inject({ method: "GET", url: `/api/analyses/${row.id}/freshness` })).json());
    expect(first).toMatchObject({ analyzedCommitSha: FIXTURE_SHA, latestCommitSha: FIXTURE_SHA, isOutdated: false });

    latestSha = NEWER;
    clock = new Date(clock.getTime() + 4 * 60_000);
    const cached = FreshnessResponseSchema.parse((await server.inject({ method: "GET", url: `/api/analyses/${row.id}/freshness` })).json());
    expect(cached.isOutdated).toBe(false);
    expect(commitCalls).toBe(1);

    clock = new Date(clock.getTime() + 2 * 60_000);
    const refreshed = FreshnessResponseSchema.parse((await server.inject({ method: "GET", url: `/api/analyses/${row.id}/freshness` })).json());
    expect(refreshed).toMatchObject({ latestCommitSha: NEWER, isOutdated: true });
    expect(commitCalls).toBe(2);
  });

  it("returns 409 not_ready before the commit is fixed", async () => {
    const queued = await repos.analyses.create(newAnalysisInput());
    const res = await (await app()).inject({ method: "GET", url: `/api/analyses/${queued.id}/freshness` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("not_ready");
  });
});

describe("POST /api/analyses/:id/regenerations", () => {
  it("creates a change_options regeneration on the same snapshot and lineage", async () => {
    const { row, snapshot } = await finished();
    const server = await app();
    const res = await regenerate(server, row.id, { mode: "change_options", level: "developer" });
    expect(res.statusCode).toBe(202);
    const child = (await repos.analyses.getById(res.json().id))!;
    expect(child).toMatchObject({
      status: "queued",
      level: "developer",
      purpose: "setup",
      snapshotId: snapshot.id,
      parentAnalysisId: row.id,
      rootAnalysisId: row.id,
      regenerationMode: "change_options",
    });
    expect(Number(child.reservedCostUsd)).toBeGreaterThan(0);

    // 부모의 versions에 두 버전이 생성순으로 보인다.
    const detail = AnalysisDetailSchema.parse((await server.inject({ method: "GET", url: `/api/analyses/${row.id}` })).json());
    expect(detail.versions.map((version) => version.id)).toEqual([row.id, child.id]);
    const childDetail = AnalysisDetailSchema.parse((await server.inject({ method: "GET", url: `/api/analyses/${child.id}` })).json());
    expect(childDetail).toMatchObject({ parentId: row.id, regenerationMode: "change_options" });
  });

  it("keeps grandchildren in the same root", async () => {
    const { row } = await finished();
    const server = await app();
    const childId = (await regenerate(server, row.id, { mode: "change_options", purpose: "modify" })).json().id;
    await repos.analyses.finish(childId, { status: "completed", stopReason: "sufficient", usage: EMPTY_USAGE });
    const grandchild = (await repos.analyses.getById((await regenerate(server, childId, { mode: "change_options", level: "vibe_coder" })).json().id))!;
    expect(grandchild).toMatchObject({ parentAnalysisId: childId, rootAnalysisId: row.id });
  });

  it("rejects change_options that changes nothing (400)", async () => {
    const { row } = await finished();
    const res = await regenerate(await app(), row.id, { mode: "change_options", level: "beginner", purpose: "setup" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
  });

  it("rejects unknown modes (400)", async () => {
    const { row } = await finished();
    expect((await regenerate(await app(), row.id, { mode: "rewrite" })).statusCode).toBe(400);
  });

  it("refuses to regenerate an analysis that has not finished (409 parent_not_finished)", async () => {
    const queued = await repos.analyses.create(newAnalysisInput());
    const res = await regenerate(await app(), queued.id, { mode: "change_options", level: "developer" });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("parent_not_finished");

    const failed = await repos.analyses.create(newAnalysisInput({ repoName: "other" }));
    await repos.analyses.finish(failed.id, { status: "failed", failureCode: "repo_empty", usage: EMPTY_USAGE });
    expect((await regenerate(await app(), failed.id, { mode: "change_options", level: "developer" })).json().error.code).toBe("parent_not_finished");
  });

  it("allows partial parents", async () => {
    const { row } = await finished("partial");
    expect((await regenerate(await app(), row.id, { mode: "change_options", level: "developer" })).statusCode).toBe(202);
  });

  it("allows refresh_commit only when a newer commit exists", async () => {
    const { row } = await finished();
    const server = await app();
    const latest = await regenerate(server, row.id, { mode: "refresh_commit" });
    expect(latest.statusCode).toBe(409);
    expect(latest.json().error.code).toBe("already_latest");

    latestSha = NEWER;
    clock = new Date(clock.getTime() + 6 * 60_000);
    const res = await regenerate(server, row.id, { mode: "refresh_commit" });
    expect(res.statusCode).toBe(202);
    expect(await repos.analyses.getById(res.json().id)).toMatchObject({
      regenerationMode: "refresh_commit",
      snapshotId: null,
      level: "beginner",
      purpose: "setup",
      parentAnalysisId: row.id,
    });
  });

  it("applies the same per-client limit and daily budget (429, 503)", async () => {
    const { row } = await finished();
    const limitedApp = await app({ LIMIT_REQUESTS_PER_CLIENT_PER_DAY: "1" });
    expect((await regenerate(limitedApp, row.id, { mode: "change_options", level: "developer" })).statusCode).toBe(202);
    const limited = await regenerate(limitedApp, row.id, { mode: "change_options", level: "vibe_coder" });
    expect(limited.statusCode).toBe(429);
    await handle.db.execute(sql`delete from analyses where parent_analysis_id is not null`);
    const broke = await regenerate(await app({ LIMIT_DAILY_COST_USD: "0.01" }), row.id, { mode: "change_options", level: "developer" });
    expect(broke.statusCode).toBe(503);
  });

  it("returns 404 and 410 like the other endpoints", async () => {
    const server = await app();
    expect((await regenerate(server, "11111111-1111-4111-8111-111111111111", { mode: "refresh_commit" })).statusCode).toBe(404);
    const { row } = await finished();
    await handle.db.execute(sql`update analyses set status = 'expired' where id = ${row.id}`);
    expect((await regenerate(server, row.id, { mode: "refresh_commit" })).statusCode).toBe(410);
  });
});
