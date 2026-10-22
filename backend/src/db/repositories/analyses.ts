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
import { and, asc, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
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
  /** 사용량 집계·만료 계산과 같은 시계를 쓰도록 앱에서 정한다. 없으면 DB의 now(). */
  createdAt?: Date;
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

/** 사용량 보호 조건 (FR-034, FR-035, research R5·R16) */
export interface Quota {
  /** 이 시각 이후 같은 접속 출처가 만든 분석 수를 센다(최근 24시간) */
  clientWindowStart: Date;
  clientLimit: number;
  /** 오늘(한국 시간 자정)부터 끝난 분석의 실제 지출을 센다 */
  dayStart: Date;
  dailyLimitUsd: number;
  /** 새 분석이 예약하는 비용(실행당 상한) */
  reserveUsd: number;
}

export type QuotaResult =
  | { ok: true; row: AnalysisRow; deduplicated: boolean }
  | { ok: false; reason: "rate_limited"; oldestInWindow: Date }
  | { ok: false; reason: "daily_budget_exhausted" };

/** 동시 요청이 함께 상한을 넘지 않도록 집계와 생성을 이 잠금으로 직렬화한다. */
const QUOTA_LOCK_KEY = 0x52_47_41_49; // "RGAI"

async function insertAnalysis(db: Database, input: NewAnalysis, reservedCostUsd = 0): Promise<AnalysisRow> {
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
      reservedCostUsd: reservedCostUsd.toFixed(4),
    })
    .returning();
  return row!;
}

type InflightKey = Pick<NewAnalysis, "repoOwner" | "repoName" | "requestedRef" | "level" | "purpose">;

/** 같은 저장소·ref·수준·목적의 진행 중 분석 (중복 요청 방지) */
async function selectInflight(db: Database, key: InflightKey): Promise<AnalysisRow | null> {
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
}

export function createAnalysesRepository(db: Database) {
  return {
    async create(input: NewAnalysis): Promise<AnalysisRow> {
      return insertAnalysis(db, input);
    },

    /**
     * 접속 출처별 24시간 요청 수와 서비스 일일 비용(지출 + 진행 중 예약 + 새 예약)을 확인한 뒤 생성한다.
     * dedupe면 진행 중인 같은 요청을 먼저 찾아 돌려준다. 같은 잠금 안에서 확인해 동시 요청이 둘 다 만들어지지 않는다.
     */
    async createWithQuota(input: NewAnalysis, quota: Quota, options: { dedupe?: boolean } = {}): Promise<QuotaResult> {
      return db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(${QUOTA_LOCK_KEY})`);

        if (options.dedupe) {
          const inflight = await selectInflight(tx, input);
          if (inflight) return { ok: true, row: inflight, deduplicated: true };
        }

        const [client] = await tx
          .select({ count: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${analyses.createdAt})` })
          .from(analyses)
          .where(and(eq(analyses.clientKeyHash, input.clientKeyHash), gte(analyses.createdAt, quota.clientWindowStart)));
        if ((client?.count ?? 0) >= quota.clientLimit) {
          return { ok: false, reason: "rate_limited", oldestInWindow: new Date(client!.oldest!) };
        }

        const [spend] = await tx
          .select({
            total: sql<string>`coalesce(sum(case when ${analyses.status} in ('queued', 'running')
                                     then ${analyses.reservedCostUsd}
                                     else (${analyses.usage}->>'costUsd')::numeric end), 0)`,
          })
          .from(analyses)
          .where(or(inArray(analyses.status, ["queued", "running"]), gte(analyses.finishedAt, quota.dayStart)));
        if (Number(spend?.total ?? 0) + quota.reserveUsd > quota.dailyLimitUsd) {
          return { ok: false, reason: "daily_budget_exhausted" };
        }

        return { ok: true, row: await insertAnalysis(tx, input, quota.reserveUsd), deduplicated: false };
      });
    },

    async listByIds(ids: string[]): Promise<AnalysisRow[]> {
      if (ids.length === 0) return [];
      return db.select().from(analyses).where(inArray(analyses.id, ids));
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

    /**
     * 워커를 거치지 않고 직접 실행하는 분석(dev:analyze, eval)을 맡는다. 실행 시간보다 긴 임대를 잡아
     * 같은 DB를 쓰는 서버의 워커가 이 분석을 가져가 두 번 실행하지 않게 한다.
     */
    async claimById(id: string, workerId: string, leaseMs: number): Promise<AnalysisRow | null> {
      const [row] = await db
        .update(analyses)
        .set({
          status: "running",
          leaseOwner: workerId,
          leaseExpiresAt: sql`now() + (${leaseMs} * interval '1 millisecond')`,
          attemptCount: sql`${analyses.attemptCount} + 1`,
          startedAt: sql`coalesce(${analyses.startedAt}, now())`,
        })
        .where(and(eq(analyses.id, id), eq(analyses.status, "queued")))
        .returning();
      return row ?? null;
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
