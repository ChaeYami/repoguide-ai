import { and, eq, inArray, lt, ne, notExists, sql } from "drizzle-orm";
import type { Database } from "../db/client.js";
import { analyses, explorationRounds, exploredFiles, manuals, repoSnapshots } from "../db/schema.js";
import type { WorkerLogger } from "./worker.js";

// 보관 기간 만료 처리 (research R17, spec Assumptions 30일 보관).
// 만료된 분석은 행만 남겨 "만료됨" 안내에 쓰고, 매뉴얼·탐색 기록·작업 집합과 아무도 쓰지 않는 스냅샷은 지운다.

export const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;

export interface CleanupResult {
  expired: number;
  snapshotsDeleted: number;
}

export async function cleanupExpired(db: Database, now: Date = new Date()): Promise<CleanupResult> {
  return db.transaction(async (tx) => {
    const expired = await tx
      .update(analyses)
      .set({ status: "expired", stage: "done", snapshotId: null, reservedCostUsd: "0", leaseOwner: null, leaseExpiresAt: null })
      .where(and(lt(analyses.expiresAt, now), ne(analyses.status, "expired")))
      .returning({ id: analyses.id });
    const ids = expired.map((row) => row.id);

    if (ids.length > 0) {
      await tx.delete(manuals).where(inArray(manuals.analysisId, ids));
      await tx.delete(explorationRounds).where(inArray(explorationRounds.analysisId, ids));
      await tx.delete(exploredFiles).where(inArray(exploredFiles.analysisId, ids));
    }

    // 어떤 분석도 가리키지 않는 스냅샷을 지운다(파일 원문은 연쇄 삭제).
    const deleted = await tx
      .delete(repoSnapshots)
      .where(notExists(tx.select({ one: sql`1` }).from(analyses).where(eq(analyses.snapshotId, repoSnapshots.id))))
      .returning({ id: repoSnapshots.id });

    return { expired: ids.length, snapshotsDeleted: deleted.length };
  });
}

/** 시작할 때 한 번, 이후 1시간마다 정리한다. */
export function startCleanup(db: Database, logger?: WorkerLogger, intervalMs = CLEANUP_INTERVAL_MS) {
  const run = () =>
    cleanupExpired(db)
      .then((result) => {
        if (result.expired > 0 || result.snapshotsDeleted > 0) logger?.info(result, "expired analyses cleaned up");
      })
      .catch((error: unknown) => logger?.error({ err: error }, "cleanup failed"));
  void run();
  const timer = setInterval(run, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
