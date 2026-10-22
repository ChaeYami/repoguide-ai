import { asc, eq } from "drizzle-orm";
import type { Database } from "../client.js";
import { explorationRounds } from "../schema.js";

export type RoundRow = typeof explorationRounds.$inferSelect;
export type NewRound = Omit<typeof explorationRounds.$inferInsert, "id" | "createdAt">;

export function createRoundsRepository(db: Database) {
  return {
    async insert(input: NewRound): Promise<RoundRow> {
      const [row] = await db.insert(explorationRounds).values(input).returning();
      return row!;
    },

    async listByAnalysis(analysisId: string): Promise<RoundRow[]> {
      return db
        .select()
        .from(explorationRounds)
        .where(eq(explorationRounds.analysisId, analysisId))
        .orderBy(asc(explorationRounds.decideNo));
    },
  };
}

export type RoundsRepository = ReturnType<typeof createRoundsRepository>;
