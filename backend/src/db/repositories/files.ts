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

    /** 작업 집합과 파일 정보(크기·잘림·원문). 분석 내역(원문 제외)과 재생성 재사용(원문 포함)에 쓴다. */
    async listWorkingSet<WithContent extends boolean = false>(
      analysisId: string,
      options: { withContent?: WithContent } = {},
    ): Promise<WorkingSetRow<WithContent>[]> {
      const rows = await db
        .select({
          explored: exploredFiles,
          sizeBytes: snapshotFiles.sizeBytes,
          truncated: snapshotFiles.truncated,
          lineCount: snapshotFiles.lineCount,
          skippedReason: snapshotFiles.skippedReason,
          ...(options.withContent ? { content: snapshotFiles.content } : {}),
        })
        .from(exploredFiles)
        .innerJoin(snapshotFiles, eq(exploredFiles.snapshotFileId, snapshotFiles.id))
        .where(eq(exploredFiles.analysisId, analysisId))
        .orderBy(asc(exploredFiles.roundNo), asc(exploredFiles.path));
      return rows.map(({ explored, ...file }) => ({ ...explored, ...file })) as WorkingSetRow<WithContent>[];
    },
  };
}

export type WorkingSetRow<WithContent extends boolean = false> = ExploredFileRow & {
  sizeBytes: number;
  truncated: boolean;
  lineCount: number;
  skippedReason: string | null;
} & (WithContent extends true ? { content: string | null } : object);

export type FilesRepository = ReturnType<typeof createFilesRepository>;
