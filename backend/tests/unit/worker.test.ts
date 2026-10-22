import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DbHandle } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { EMPTY_USAGE } from "../../src/db/repositories/analyses.js";
import { createWorker, type AnalysisHandler } from "../../src/jobs/worker.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { createPgliteDb } from "../support/pglite-db.js";

let handle: DbHandle;
let repos: Repositories;

beforeAll(async () => {
  handle = await createPgliteDb();
  repos = createRepositories(handle.db);
}, 60_000);
afterAll(async () => handle.close());
beforeEach(async () => {
  await handle.db.execute(sql`truncate analyses cascade`);
});

function worker(handler: AnalysisHandler, overrides: Partial<Parameters<typeof createWorker>[0]> = {}) {
  return createWorker({ analyses: repos.analyses, handler, concurrency: 1, runTimeoutMs: 5_000, ...overrides });
}

const complete: AnalysisHandler = async (row) => {
  await repos.analyses.finish(row.id, { status: "completed", stopReason: "sufficient", usage: EMPTY_USAGE });
};

describe("worker", () => {
  it("claims the oldest queued analysis, leases it and runs the handler", async () => {
    const older = await repos.analyses.create(newAnalysisInput());
    await repos.analyses.create(newAnalysisInput());
    const seen: { id: string; status: string; attempt: number; owner: string | null }[] = [];
    const w = worker(async (row, signal) => {
      seen.push({ id: row.id, status: row.status, attempt: row.attemptCount, owner: row.leaseOwner });
      expect(signal.aborted).toBe(false);
      await complete(row, signal);
    });

    expect(await w.runOnce()).toBe(true);
    expect(seen).toEqual([{ id: older.id, status: "running", attempt: 1, owner: w.workerId }]);
    const row = await repos.analyses.getById(older.id);
    expect(row).toMatchObject({ status: "completed", leaseOwner: null });
    expect(row!.startedAt).toBeInstanceOf(Date);
  });

  it("returns false when there is nothing to do", async () => {
    expect(await worker(complete).runOnce()).toBe(false);
  });

  it("never gives the same analysis to two workers", async () => {
    const a = await repos.analyses.create(newAnalysisInput());
    const b = await repos.analyses.create(newAnalysisInput());
    const first = await repos.analyses.claimNext("w1", 60_000);
    const second = await repos.analyses.claimNext("w2", 60_000);
    expect([first?.id, second?.id].sort()).toEqual([a.id, b.id].sort());
    expect(await repos.analyses.claimNext("w3", 60_000)).toBeNull();
  });

  it("re-claims an analysis whose lease expired and counts the attempt", async () => {
    const { id } = await repos.analyses.create(newAnalysisInput());
    await repos.analyses.claimNext("dead-worker", 60_000);
    await handle.db.execute(sql`update analyses set lease_expires_at = now() - interval '1 second' where id = ${id}`);

    const attempts: number[] = [];
    const w = worker(async (row, signal) => {
      attempts.push(row.attemptCount);
      await complete(row, signal);
    });
    expect(await w.runOnce()).toBe(true);
    expect(attempts).toEqual([2]);
  });

  it("fails an analysis that exceeded the attempt limit without running it", async () => {
    const { id } = await repos.analyses.create(newAnalysisInput());
    await handle.db.execute(
      sql`update analyses set status = 'running', attempt_count = 2, lease_expires_at = now() - interval '1 second' where id = ${id}`,
    );
    let called = false;
    await worker(async () => void (called = true)).runOnce();
    expect(called).toBe(false);
    expect(await repos.analyses.getById(id)).toMatchObject({ status: "failed", failureCode: "internal_error" });
  });

  it("records internal_error when the handler throws or forgets to finish", async () => {
    const thrown = await repos.analyses.create(newAnalysisInput());
    await worker(async () => {
      throw new Error("boom");
    }).runOnce();
    expect(await repos.analyses.getById(thrown.id)).toMatchObject({ status: "failed", failureCode: "internal_error" });

    const forgotten = await repos.analyses.create(newAnalysisInput());
    await worker(async () => {}).runOnce();
    expect(await repos.analyses.getById(forgotten.id)).toMatchObject({ status: "failed", failureCode: "internal_error" });
  });

  it("aborts the handler at the run timeout and records timeout", async () => {
    const { id } = await repos.analyses.create(newAnalysisInput());
    let sawAbort = false;
    await worker(
      (_row, signal) =>
        new Promise<void>((resolve) => {
          signal.addEventListener("abort", () => {
            sawAbort = true;
            resolve();
          });
        }),
      { runTimeoutMs: 30 },
    ).runOnce();
    expect(sawAbort).toBe(true);
    expect(await repos.analyses.getById(id)).toMatchObject({ status: "failed", failureCode: "timeout" });
  });

  it("extends the lease while the handler runs", async () => {
    const { id } = await repos.analyses.create(newAnalysisInput());
    const expiries: number[] = [];
    await worker(
      async (row, signal) => {
        for (let i = 0; i < 3; i += 1) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          expiries.push((await repos.analyses.getById(row.id))!.leaseExpiresAt!.getTime());
        }
        await complete(row, signal);
      },
      { heartbeatMs: 10, leaseMs: 60_000 },
    ).runOnce();
    expect(expiries[2]!).toBeGreaterThan(expiries[0]!);
    expect((await repos.analyses.getById(id))!.status).toBe("completed");
  });
});
