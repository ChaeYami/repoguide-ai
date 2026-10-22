import type {
  AnalysisStage,
  FailureCode,
  Level,
  PartialReason,
  Progress,
  Purpose,
  RegenerationMode,
  StopReason,
  Usage,
} from "@repoguide/shared";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Limits } from "../../config/limits.js";
import type { Database } from "../client.js";
import { analyses } from "../schema.js";

export type AnalysisRow = typeof analyses.$inferSelect;

export interface NewAnalysis {
  id?: string;
  rootAnalysisId?: string;
  parentAnalysisId?: string | null;
  regenerationMode?: RegenerationMode | null;
  snapshotId?: string | null;
  repoOwner: string;
  repoName: string;
  requestedRef: string | null;
  subpath: string | null;
  level: Level;
  purpose: Purpose;
  limits: Limits;
  promptVersion: string;
  clientKeyHash: string;
  expiresAt: Date;
}

export type AnalysisOutcome =
  | { status: "completed"; stopReason: StopReason | null; usage: Usage }
  | { status: "partial"; stopReason: StopReason | null; partialReasons: PartialReason[]; usage: Usage }
  | { status: "failed"; failureCode: FailureCode; failureRetryAt?: Date | null; usage: Usage };

export const EMPTY_USAGE: Usage = {
  rounds: 0,
  filesRead: 0,
  githubCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  costUsd: 0,
  usageEstimated: false,
};

export function createAnalysesRepository(db: Database) {
  return {
    async create(input: NewAnalysis): Promise<AnalysisRow> {
      const id = input.id ?? crypto.randomUUID();
      const progress: Progress = {
        round: 0,
        maxRounds: input.limits.maxRounds,
        filesRead: 0,
        filesPlanned: 0,
        activity: null,
        updatedAt: new Date().toISOString(),
      };
      const [row] = await db
        .insert(analyses)
        .values({
          ...input,
          id,
          rootAnalysisId: input.rootAnalysisId ?? id,
          progress,
          usage: EMPTY_USAGE,
        })
        .returning();
      return row!;
    },

    async getById(id: string): Promise<AnalysisRow | null> {
      const [row] = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
      return row ?? null;
    },

    async updateProgress(id: string, update: { stage?: AnalysisStage; progress: Progress }) {
      await db
        .update(analyses)
        .set({ progress: update.progress, ...(update.stage ? { stage: update.stage } : {}) })
        .where(eq(analyses.id, id));
    },

    async attachSnapshot(id: string, snapshotId: string, subpath: string | null) {
      await db.update(analyses).set({ snapshotId, subpath }).where(eq(analyses.id, id));
    },

    /** 같은 저장소·ref·수준·목적의 진행 중 분석 (중복 요청 방지) */
    async findInflight(key: Pick<NewAnalysis, "repoOwner" | "repoName" | "requestedRef" | "level" | "purpose">) {
      const [row] = await db
        .select()
        .from(analyses)
        .where(
          and(
            eq(analyses.repoOwner, key.repoOwner),
            eq(analyses.repoName, key.repoName),
            key.requestedRef === null ? isNull(analyses.requestedRef) : eq(analyses.requestedRef, key.requestedRef),
            eq(analyses.level, key.level),
            eq(analyses.purpose, key.purpose),
            inArray(analyses.status, ["queued", "running"]),
          ),
        )
        .orderBy(asc(analyses.createdAt))
        .limit(1);
      return row ?? null;
    },

    /** 이 시각보다 먼저 들어와 아직 대기 중인 분석 수 (queuePosition 계산) */
    async countQueuedBefore(createdAt: Date): Promise<number> {
      const [row] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(analyses)
        .where(and(eq(analyses.status, "queued"), lt(analyses.createdAt, createdAt)));
      return row?.count ?? 0;
    },

    /** 같은 계보(root)의 분석들, 생성순 (버전 목록) */
    async listByRoot(rootAnalysisId: string): Promise<AnalysisRow[]> {
      return db
        .select()
        .from(analyses)
        .where(eq(analyses.rootAnalysisId, rootAnalysisId))
        .orderBy(asc(analyses.createdAt));
    },

    /**
     * 대기 중이거나 임대가 만료된 가장 오래된 분석을 가져온다(research R10).
     * SKIP LOCKED로 여러 워커가 같은 작업을 잡지 않는다.
     */
    async claimNext(workerId: string, leaseMs: number): Promise<AnalysisRow | null> {
      const rows = await db
        .update(analyses)
        .set({
          status: "running",
          leaseOwner: workerId,
          leaseExpiresAt: sql`now() + (${leaseMs} * interval '1 millisecond')`,
          attemptCount: sql`${analyses.attemptCount} + 1`,
          startedAt: sql`coalesce(${analyses.startedAt}, now())`,
        })
        .where(
          eq(
            analyses.id,
            sql`(select id from analyses
                 where status = 'queued' or (status = 'running' and lease_expires_at < now())
                 order by created_at
                 for update skip locked
                 limit 1)`,
          ),
        )
        .returning();
      return rows[0] ?? null;
    },

    /** 임대를 연장한다. 이미 다른 워커가 가져갔으면 false. */
    async extendLease(id: string, workerId: string, leaseMs: number): Promise<boolean> {
      const rows = await db
        .update(analyses)
        .set({ leaseExpiresAt: sql`now() + (${leaseMs} * interval '1 millisecond')` })
        .where(and(eq(analyses.id, id), eq(analyses.leaseOwner, workerId), eq(analyses.status, "running")))
        .returning({ id: analyses.id });
      return rows.length > 0;
    },

    async finish(id: string, outcome: AnalysisOutcome) {
      await db
        .update(analyses)
        .set({
          status: outcome.status,
          stage: "done",
          usage: outcome.usage,
          stopReason: outcome.status === "failed" ? null : outcome.stopReason,
          partialReasons: outcome.status === "partial" ? outcome.partialReasons : [],
          failureCode: outcome.status === "failed" ? outcome.failureCode : null,
          failureRetryAt: outcome.status === "failed" ? (outcome.failureRetryAt ?? null) : null,
          reservedCostUsd: "0",
          leaseOwner: null,
          leaseExpiresAt: null,
          finishedAt: new Date(),
        })
        .where(eq(analyses.id, id));
    },
  };
}

export type AnalysesRepository = ReturnType<typeof createAnalysesRepository>;
