import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseLimits } from "../../src/config/limits.js";
import { type DbHandle, queryRows } from "../../src/db/client.js";
import {
  createRepositories,
  type Repositories,
} from "../../src/db/repositories/index.js";
import { EMPTY_USAGE, type NewAnalysis } from "../../src/db/repositories/analyses.js";
import { analyses } from "../../src/db/schema.js";

// 같은 계약을 PGlite(npm test)와 실제 Postgres(npm run test:db) 양쪽에 적용한다.

const TABLES = [
  "repo_snapshots",
  "snapshot_files",
  "analyses",
  "exploration_rounds",
  "explored_files",
  "manuals",
];
const SHA = "0123456789abcdef0123456789abcdef01234567";

function newAnalysis(overrides: Partial<NewAnalysis> = {}): NewAnalysis {
  return {
    repoOwner: "acme",
    repoName: "app",
    requestedRef: null,
    subpath: null,
    level: "beginner",
    purpose: "setup",
    limits: parseLimits({}),
    promptVersion: "test",
    clientKeyHash: "client-hash",
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    ...overrides,
  };
}

const snapshotInput = {
  owner: "acme",
  name: "app",
  commitSha: SHA,
  ref: "main",
  defaultBranch: "main",
  description: null,
  primaryLanguage: "TypeScript",
  treeEntryCount: 3,
  candidateCount: 2,
  treeTruncated: false,
  candidates: [{ path: "README.md", size: 10, blobSha: "b1" }],
  detectedStack: { languages: ["TypeScript"], packageManagers: ["npm"], frameworkHints: [], manifests: ["package.json"] },
};

export function describeRepositoryContract(label: string, connect: () => Promise<DbHandle>) {
  describe(`repositories contract (${label})`, () => {
    let handle: DbHandle;
    let repos: Repositories;

    beforeAll(async () => {
      handle = await connect();
      repos = createRepositories(handle.db);
    }, 60_000);

    afterAll(async () => {
      await handle?.close();
    });

    beforeEach(async () => {
      await handle.db.execute(sql.raw(`TRUNCATE ${TABLES.join(", ")} CASCADE`));
    });

    it("creates an analysis with documented defaults", async () => {
      const created = await repos.analyses.create(newAnalysis());
      const row = await repos.analyses.getById(created.id);
      expect(row).toMatchObject({
        status: "queued",
        stage: "queued",
        rootAnalysisId: created.id,
        parentAnalysisId: null,
        attemptCount: 0,
        partialReasons: [],
        usage: EMPTY_USAGE,
      });
      expect(Number(row!.reservedCostUsd)).toBe(0);
      expect(row!.progress).toMatchObject({ round: 0, maxRounds: 3, activity: null });
    });

    it("rejects a failed analysis without a failure code", async () => {
      const { id } = await repos.analyses.create(newAnalysis());
      await expect(
        handle.db.execute(sql`update analyses set status = 'failed' where id = ${id}`),
      ).rejects.toThrow();
    });

    it("rejects a partial analysis without reasons and accepts one with reasons", async () => {
      const { id } = await repos.analyses.create(newAnalysis());
      await expect(
        repos.analyses.finish(id, { status: "partial", stopReason: "round_limit", partialReasons: [], usage: EMPTY_USAGE }),
      ).rejects.toThrow();
      await repos.analyses.finish(id, {
        status: "partial",
        stopReason: "round_limit",
        partialReasons: ["round_limit"],
        usage: EMPTY_USAGE,
      });
      const row = await repos.analyses.getById(id);
      expect(row).toMatchObject({ status: "partial", stage: "done", partialReasons: ["round_limit"] });
      expect(row!.finishedAt).toBeInstanceOf(Date);
    });

    it("records rate-limit failures with a retry time", async () => {
      const { id } = await repos.analyses.create(newAnalysis());
      const retryAt = new Date(Date.now() + 60_000);
      await repos.analyses.finish(id, {
        status: "failed",
        failureCode: "github_rate_limited",
        failureRetryAt: retryAt,
        usage: EMPTY_USAGE,
      });
      const row = await repos.analyses.getById(id);
      expect(row).toMatchObject({ status: "failed", failureCode: "github_rate_limited" });
      expect(row!.failureRetryAt?.getTime()).toBe(retryAt.getTime());
    });

    it("rejects a regeneration without a parent", async () => {
      await expect(
        repos.analyses.create(newAnalysis({ regenerationMode: "change_options" })),
      ).rejects.toThrow();
    });

    it("upserts snapshots idempotently and validates the commit SHA format", async () => {
      const first = await repos.snapshots.upsert(snapshotInput);
      const second = await repos.snapshots.upsert(snapshotInput);
      expect(second.id).toBe(first.id);
      await expect(repos.snapshots.upsert({ ...snapshotInput, commitSha: "main" })).rejects.toThrow();
    });

    it("caches snapshot files per (snapshot, path)", async () => {
      const snapshot = await repos.snapshots.upsert(snapshotInput);
      const file = {
        snapshotId: snapshot.id,
        path: "README.md",
        blobSha: "b1",
        sizeBytes: 10,
        content: "# app\n",
        lineCount: 1,
        truncated: false,
        skippedReason: null,
      };
      const first = await repos.files.upsertSnapshotFile(file);
      const second = await repos.files.upsertSnapshotFile({ ...file, content: "changed" });
      expect(second.id).toBe(first.id);
      expect((await repos.files.getSnapshotFile(snapshot.id, "README.md"))?.content).toBe("# app\n");
      expect(await repos.files.getSnapshotFile(snapshot.id, "missing.md")).toBeNull();
    });

    it("stores rounds, explored files and one manual per analysis, and cascades on delete", async () => {
      const snapshot = await repos.snapshots.upsert(snapshotInput);
      const { id } = await repos.analyses.create(newAnalysis({ snapshotId: snapshot.id }));
      const file = await repos.files.upsertSnapshotFile({
        snapshotId: snapshot.id,
        path: "README.md",
        blobSha: "b1",
        sizeBytes: 10,
        content: "# app\n",
        lineCount: 1,
        truncated: false,
        skippedReason: null,
      });

      await repos.rounds.insert({
        analysisId: id,
        decideNo: 1,
        model: "gemini-3.5-flash-lite",
        inputFilePaths: [],
        requests: [{ path: "src/a.ts", reason: "진입점", accepted: false, rejectReason: "not_in_tree" }],
        expandedDirectories: [],
        coverage: [],
        fileNotes: [],
        sufficient: false,
        usage: EMPTY_USAGE,
      });
      await repos.files.addExploredFile({
        analysisId: id,
        snapshotFileId: file.id,
        path: "README.md",
        roundNo: 1,
        source: "seed",
        reason: "readme",
      });

      const manualInput = {
        analysisId: id,
        level: "beginner" as const,
        purpose: "setup" as const,
        document: {} as never,
        stats: { blocks: 0, facts: 0, inferences: 0, evidenceKept: 0, evidenceDropped: 0, downgraded: 0, sectionsNotFound: 6, stepWarnings: 0 },
        model: "gemini-3.8-flash",
        usage: EMPTY_USAGE,
      };
      await repos.manuals.insert(manualInput);
      await expect(repos.manuals.insert(manualInput)).rejects.toThrow();

      expect((await repos.rounds.listByAnalysis(id)).map((round) => round.decideNo)).toEqual([1]);
      expect((await repos.files.listExploredFiles(id)).map((row) => row.path)).toEqual(["README.md"]);
      expect(await repos.manuals.getByAnalysisId(id)).not.toBeNull();

      await handle.db.delete(analyses).where(sql`${analyses.id} = ${id}`);
      expect(await repos.rounds.listByAnalysis(id)).toEqual([]);
      expect(await repos.files.listExploredFiles(id)).toEqual([]);
      expect(await repos.manuals.getByAnalysisId(id)).toBeNull();
    });

    it("has the pgvector extension installed and usable", async () => {
      const rows = await queryRows<{ distance: number }>(
        handle.db,
        sql.raw(
          "select '[1,2,3]'::extensions.vector OPERATOR(extensions.<->) '[1,2,4]'::extensions.vector as distance",
        ),
      );
      expect(Number(rows[0]!.distance)).toBeCloseTo(1);
    });

    it("enables row level security on every table", async () => {
      const rows = await queryRows<{ relname: string; relrowsecurity: boolean }>(
        handle.db,
        sql.raw(
          `select relname, relrowsecurity from pg_class where relname in (${TABLES.map((t) => `'${t}'`).join(", ")}) and relkind = 'r'`,
        ),
      );
      expect(rows).toHaveLength(TABLES.length);
      expect(rows.every((row) => row.relrowsecurity)).toBe(true);
    });
  });
}
