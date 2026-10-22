import { and, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { repoSnapshots } from "../schema.js";

export type SnapshotRow = typeof repoSnapshots.$inferSelect;
export type NewSnapshot = Omit<typeof repoSnapshots.$inferInsert, "id" | "createdAt">;

export function createSnapshotsRepository(db: Database) {
  return {
    /** 같은 (owner, name, commit) 스냅샷이 있으면 그것을 재사용한다. 커밋이 고정이므로 내용도 같다. */
    async upsert(input: NewSnapshot): Promise<SnapshotRow> {
      const [inserted] = await db
        .insert(repoSnapshots)
        .values(input)
        .onConflictDoNothing({
          target: [repoSnapshots.owner, repoSnapshots.name, repoSnapshots.commitSha],
        })
        .returning();
      if (inserted) return inserted;
      const [existing] = await db
        .select()
        .from(repoSnapshots)
        .where(
          and(
            eq(repoSnapshots.owner, input.owner),
            eq(repoSnapshots.name, input.name),
            eq(repoSnapshots.commitSha, input.commitSha),
          ),
        )
        .limit(1);
      return existing!;
    },

    async findByCommit(owner: string, name: string, commitSha: string): Promise<SnapshotRow | null> {
      const [row] = await db
        .select()
        .from(repoSnapshots)
        .where(and(eq(repoSnapshots.owner, owner), eq(repoSnapshots.name, name), eq(repoSnapshots.commitSha, commitSha)))
        .limit(1);
      return row ?? null;
    },

    async getById(id: string): Promise<SnapshotRow | null> {
      const [row] = await db.select().from(repoSnapshots).where(eq(repoSnapshots.id, id)).limit(1);
      return row ?? null;
    },
  };
}

export type SnapshotsRepository = ReturnType<typeof createSnapshotsRepository>;
