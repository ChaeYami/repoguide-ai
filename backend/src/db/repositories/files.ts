import { and, asc, eq, inArray } from "drizzle-orm";
import type { Database } from "../client.js";
import { exploredFiles, snapshotFiles } from "../schema.js";

export type SnapshotFileRow = typeof snapshotFiles.$inferSelect;
export type NewSnapshotFile = Omit<typeof snapshotFiles.$inferInsert, "id" | "fetchedAt">;
export type ExploredFileRow = typeof exploredFiles.$inferSelect;
export type NewExploredFile = typeof exploredFiles.$inferInsert;

/** 파일 원문 캐시. file-reader가 이 인터페이스만 의존한다. */
export interface FileCache {
  getSnapshotFile(snapshotId: string, path: string): Promise<SnapshotFileRow | null>;
  upsertSnapshotFile(input: NewSnapshotFile): Promise<SnapshotFileRow>;
}

export function createFilesRepository(db: Database) {
  async function getSnapshotFile(snapshotId: string, path: string) {
    const [row] = await db
      .select()
      .from(snapshotFiles)
      .where(and(eq(snapshotFiles.snapshotId, snapshotId), eq(snapshotFiles.path, path)))
      .limit(1);
    return row ?? null;
  }

  return {
    getSnapshotFile,

    async upsertSnapshotFile(input: NewSnapshotFile): Promise<SnapshotFileRow> {
      const [inserted] = await db
        .insert(snapshotFiles)
        .values(input)
        .onConflictDoNothing({ target: [snapshotFiles.snapshotId, snapshotFiles.path] })
        .returning();
      return inserted ?? (await getSnapshotFile(input.snapshotId, input.path))!;
    },

    async addExploredFile(input: NewExploredFile) {
      await db.insert(exploredFiles).values(input);
    },

    /** Write에 원문을 전달한 파일을 표시한다 (content_trimmed 판정·분석 내역용) */
    async markIncludedInWrite(analysisId: string, paths: string[]) {
      if (paths.length === 0) return;
      await db
        .update(exploredFiles)
        .set({ contentIncludedInWrite: true })
        .where(and(eq(exploredFiles.analysisId, analysisId), inArray(exploredFiles.path, paths)));
    },

    async listExploredFiles(analysisId: string): Promise<ExploredFileRow[]> {
      return db
        .select()
        .from(exploredFiles)
        .where(eq(exploredFiles.analysisId, analysisId))
        .orderBy(asc(exploredFiles.roundNo), asc(exploredFiles.path));
    },
  };
}

export type FilesRepository = ReturnType<typeof createFilesRepository>;
