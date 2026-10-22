import { eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { manuals } from "../schema.js";

export type ManualRow = typeof manuals.$inferSelect;
export type NewManual = Omit<typeof manuals.$inferInsert, "id" | "createdAt">;

export function createManualsRepository(db: Database) {
  return {
    async insert(input: NewManual): Promise<ManualRow> {
      const [row] = await db.insert(manuals).values(input).returning();
      return row!;
    },

    async getByAnalysisId(analysisId: string): Promise<ManualRow | null> {
      const [row] = await db
        .select()
        .from(manuals)
        .where(eq(manuals.analysisId, analysisId))
        .limit(1);
      return row ?? null;
    },
  };
}

export type ManualsRepository = ReturnType<typeof createManualsRepository>;
