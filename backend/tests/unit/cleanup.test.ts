import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerAnalysesRoutes } from "../../src/api/routes/analyses.js";
import { buildServer } from "../../src/api/server.js";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { EMPTY_USAGE } from "../../src/db/repositories/analyses.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { cleanupExpired } from "../../src/jobs/cleanup.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { FIXTURE_SHA, fixtureCandidates } from "../support/fake-repo.js";
import { createPgliteDb } from "../support/pglite-db.js";

// 보관 기간 만료 (T040, research R17). PGlite에서 실제 마이그레이션 SQL로 검증한다.

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

const NOW = new Date("2026-11-30T00:00:00Z");

async function countSnapshotFiles(): Promise<number> {
  const result = (await handle.db.execute(sql`select count(*)::int as n from snapshot_files`)) as unknown as { rows: { n: number }[] };
  return result.rows[0]!.n;
}

async function finishedAnalysis(expiresAt: Date, sha = FIXTURE_SHA) {
  const snapshot = await repos.snapshots.upsert({
    owner: "acme",
    name: "app",
    commitSha: sha,
    ref: "main",
    defaultBranch: "main",
    description: null,
    primaryLanguage: null,
    treeEntryCount: 1,
    candidateCount: 1,
    treeTruncated: false,
    candidates: fixtureCandidates(),
    detectedStack: { languages: [], packageManagers: [], frameworkHints: [], manifests: [] },
  });
  const analysis = await repos.analyses.create(newAnalysisInput({ expiresAt, snapshotId: snapshot.id }));
  const file = await repos.files.upsertSnapshotFile({
    snapshotId: snapshot.id, path: "README.md", blobSha: "b", sizeBytes: 3, content: "# x\n", lineCount: 1, truncated: false, skippedReason: null,
  });
  await repos.files.addExploredFile({ analysisId: analysis.id, snapshotFileId: file.id, path: "README.md", roundNo: 1, source: "seed", reason: "readme" });
  await repos.rounds.insert({
    analysisId: analysis.id, decideNo: 1, model: "m", inputFilePaths: [], requests: [], expandedDirectories: [], coverage: [], fileNotes: [], sufficient: true, usage: EMPTY_USAGE,
  });
  await repos.manuals.insert({
    analysisId: analysis.id,
    level: "beginner",
    purpose: "setup",
    model: "m",
    usage: EMPTY_USAGE,
    stats: { blocks: 0, facts: 0, inferences: 0, evidenceKept: 0, evidenceDropped: 0, downgraded: 0, sectionsNotFound: 6, stepWarnings: 0 },
    document: {} as never,
  });
  await repos.analyses.finish(analysis.id, { status: "partial", stopReason: "round_limit", partialReasons: ["round_limit"], usage: EMPTY_USAGE });
  return { analysis, snapshot };
}

describe("cleanupExpired", () => {
  it("expires old analyses, deletes their manual, rounds and working set, and keeps the row", async () => {
    const old = await finishedAnalysis(new Date("2026-11-01T00:00:00Z"));
    const fresh = await finishedAnalysis(new Date("2026-12-30T00:00:00Z"), "b".repeat(40));

    expect(await cleanupExpired(handle.db, NOW)).toEqual({ expired: 1, snapshotsDeleted: 1 });

    expect(await repos.analyses.getById(old.analysis.id)).toMatchObject({ status: "expired", snapshotId: null, reservedCostUsd: "0.0000" });
    expect(await repos.manuals.getByAnalysisId(old.analysis.id)).toBeNull();
    expect(await repos.rounds.listByAnalysis(old.analysis.id)).toEqual([]);
    expect(await repos.files.listExploredFiles(old.analysis.id)).toEqual([]);
    expect(await repos.snapshots.getById(old.snapshot.id)).toBeNull();

    // 보관 기간 안의 분석과 그 스냅샷·파일 원문은 그대로다.
    expect(await repos.manuals.getByAnalysisId(fresh.analysis.id)).not.toBeNull();
    expect(await repos.snapshots.getById(fresh.snapshot.id)).not.toBeNull();
    expect(await countSnapshotFiles()).toBe(1);
  });

  it("keeps a snapshot still used by another analysis and is idempotent", async () => {
    const old = await finishedAnalysis(new Date("2026-11-01T00:00:00Z"));
    const sharing = await repos.analyses.create(newAnalysisInput({ expiresAt: new Date("2026-12-30T00:00:00Z"), snapshotId: old.snapshot.id }));
    expect(await cleanupExpired(handle.db, NOW)).toEqual({ expired: 1, snapshotsDeleted: 0 });
    expect(await repos.snapshots.getById(old.snapshot.id)).not.toBeNull();
    expect(await cleanupExpired(handle.db, NOW)).toEqual({ expired: 0, snapshotsDeleted: 0 });
    expect((await repos.analyses.getById(sharing.id))!.status).toBe("queued");
  });

  it("makes every read endpoint answer 410 for expired analyses", async () => {
    const old = await finishedAnalysis(new Date("2026-11-01T00:00:00Z"));
    await cleanupExpired(handle.db, NOW);
    const app = await buildServer({
      db: handle,
      logger: false,
      routes: (instance) => registerAnalysesRoutes(instance, { repos, limits: parseLimits({}), retentionDays: 30, clientKeySalt: "s".repeat(40) }),
    });
    for (const suffix of ["", "/manual", "/trace"]) {
      const res = await app.inject({ method: "GET", url: `/api/analyses/${old.analysis.id}${suffix}` });
      expect(res.statusCode, suffix || "detail").toBe(410);
      expect(res.json().error).toMatchObject({ code: "expired", action: "같은 저장소를 다시 분석해 주세요." });
    }
  });
});
