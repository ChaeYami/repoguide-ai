import {
  type AnalysisDetail,
  AnalysisDetailSchema,
  type AnalysisSummary,
  BatchSummaryResponseSchema,
  CreateAnalysisRequestSchema,
  CreateAnalysisResponseSchema,
  type FreshnessResponse,
  FreshnessResponseSchema,
  ManualSchema,
  parseRepoUrl,
  RegenerationRequestSchema,
  RegenerationResponseSchema,
  type TraceResponse,
  TraceResponseSchema,
} from "@repoguide/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Limits } from "../../config/limits.js";
import type { AnalysisRow, NewAnalysis } from "../../db/repositories/analyses.js";
import type { Repositories } from "../../db/repositories/index.js";
import type { SnapshotRow } from "../../db/repositories/snapshots.js";
import type { FreshnessCache } from "../../github/freshness-cache.js";
import { blobUrl } from "../../github/permalink.js";
import { PROMPT_VERSION } from "../../llm/prompts/file-block.js";
import { isLimitStop } from "../../pipeline/budget.js";
import { analysisFromUrl } from "../../pipeline/new-analysis.js";
import { hashClientKey } from "../client-key.js";
import { ApiError } from "../errors.js";
import { FAILURE_MESSAGES, PARTIAL_MESSAGES } from "../messages.js";
import { dailyBudgetRetryAfterSec, quotaFor, rateLimitRetryAfterSec } from "../quota.js";

// 분석 시작·상태·매뉴얼 조회 (contracts/http-api.md, FR-001~FR-005, FR-018, FR-028, FR-031).

export interface AnalysesRouteDeps {
  repos: Repositories;
  limits: Limits;
  retentionDays: number;
  clientKeySalt: string;
  /** 최신 커밋 확인(새 커밋 안내, refresh_commit 재생성). 없으면 해당 엔드포인트는 쓰지 않는다. */
  freshness?: FreshnessCache;
  now?: () => Date;
}

const IdParams = z.object({ id: z.string() });
const BatchQuery = z.object({ ids: z.string().max(1_000) });
const MAX_BATCH_IDS = 20;

export function registerAnalysesRoutes(app: FastifyInstance, deps: AnalysesRouteDeps) {
  const { repos } = deps;
  const now = deps.now ?? (() => new Date());

  async function load(id: string): Promise<AnalysisRow> {
    const row = z.uuid().safeParse(id).success ? await repos.analyses.getById(id) : null;
    if (!row) throw new ApiError(404, "not_found", "분석을 찾을 수 없습니다.");
    if (row.status === "expired") {
      throw new ApiError(410, "expired", "보관 기간이 지나 결과가 삭제되었습니다.", { action: "같은 저장소를 다시 분석해 주세요." });
    }
    return row;
  }

  /** 요청 제한과 일일 비용 상한을 확인하고 분석을 만든다 (FR-034, FR-035). 재생성도 같은 검사를 거친다. */
  async function createWithQuota(input: NewAnalysis, options: { dedupe?: boolean } = {}) {
    const at = now();
    const result = await repos.analyses.createWithQuota(input, quotaFor(deps.limits, at), options);
    if (result.ok) return result;
    if (result.reason === "rate_limited") {
      throw new ApiError(429, "rate_limited", `오늘 분석 요청 한도(24시간에 ${deps.limits.requestsPerClientPerDay}회)에 도달했습니다.`, {
        action: "안내된 시간이 지난 뒤 다시 시도해 주세요.",
        retryAfterSec: rateLimitRetryAfterSec(result.oldestInWindow, at),
      });
    }
    throw new ApiError(503, "daily_budget_exhausted", "오늘 서비스 사용량 한도에 도달해 새 분석을 받을 수 없습니다.", {
      action: "한국 시간 자정 이후 다시 시도해 주세요.",
      retryAfterSec: dailyBudgetRetryAfterSec(at),
    });
  }

  async function snapshotsFor(rows: AnalysisRow[]): Promise<Map<string, SnapshotRow>> {
    const ids = [...new Set(rows.flatMap((row) => (row.snapshotId ? [row.snapshotId] : [])))];
    const found = await Promise.all(ids.map((id) => repos.snapshots.getById(id)));
    return new Map(found.flatMap((snapshot) => (snapshot ? [[snapshot.id, snapshot] as const] : [])));
  }

  function toSummary(row: AnalysisRow, snapshot: SnapshotRow | undefined): AnalysisSummary {
    return {
      id: row.id,
      repo: {
        owner: row.repoOwner,
        name: row.repoName,
        ref: snapshot?.ref ?? null,
        commitSha: snapshot?.commitSha ?? null,
        subpath: row.subpath,
        htmlUrl: `https://github.com/${row.repoOwner}/${row.repoName}`,
      },
      level: row.level,
      purpose: row.purpose,
      status: row.status,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
    };
  }

  async function toDetail(row: AnalysisRow): Promise<AnalysisDetail> {
    const versions = await repos.analyses.listByRoot(row.rootAnalysisId);
    const snapshots = await snapshotsFor([row, ...versions]);
    const snapshot = row.snapshotId ? snapshots.get(row.snapshotId) : undefined;
    const retryAfterSec = row.failureRetryAt
      ? Math.max(0, Math.ceil((row.failureRetryAt.getTime() - now().getTime()) / 1000))
      : null;
    return {
      ...toSummary(row, snapshot),
      stage: row.stage,
      progress: { ...row.progress, activity: row.progress.activity ?? null },
      queuePosition: row.status === "queued" ? (await repos.analyses.countQueuedBefore(row.createdAt)) + 1 : null,
      failure:
        row.status === "failed" && row.failureCode
          ? { code: row.failureCode, ...FAILURE_MESSAGES[row.failureCode], retryAfterSec }
          : null,
      partialReasons: row.partialReasons.map((code) => ({ code, message: PARTIAL_MESSAGES[code] })),
      hasManual: row.status === "completed" || row.status === "partial",
      expiresAt: row.expiresAt.toISOString(),
      parentId: row.parentAnalysisId,
      regenerationMode: row.regenerationMode,
      versions: versions.map((version) => toSummary(version, version.snapshotId ? snapshots.get(version.snapshotId) : undefined)),
    };
  }

  app.post("/api/analyses", async (request, reply) => {
    const body = CreateAnalysisRequestSchema.parse(request.body);
    const parsed = parseRepoUrl(body.repoUrl);
    if (!parsed.ok) {
      throw new ApiError(400, "invalid_url", parsed.error.message, { action: `예: ${parsed.error.example}` });
    }
    const input = analysisFromUrl(parsed.value, {
      level: body.level,
      purpose: body.purpose,
      limits: deps.limits,
      clientKeyHash: hashClientKey(request.ip, deps.clientKeySalt),
      retentionDays: deps.retentionDays,
      now: now(),
    });

    // 진행 중인 같은 요청은 새로 만들지 않고 돌려준다. 요청 수에도 세지 않는다.
    const { row, deduplicated } = await createWithQuota(input, { dedupe: true });
    return reply.code(202).send(CreateAnalysisResponseSchema.parse({ id: row.id, status: row.status, deduplicated }));
  });

  // 브라우저 최근 목록의 현재 상태 (FR-030, research R14). 만료·삭제·없는 ID는 missingIds로 돌려준다.
  app.get("/api/analyses", async (request) => {
    const raw = BatchQuery.parse(request.query).ids;
    const ids = [...new Set(raw.split(",").map((value) => value.trim()).filter(Boolean))];
    if (ids.length === 0 || ids.length > MAX_BATCH_IDS || ids.some((value) => !z.uuid().safeParse(value).success)) {
      throw new ApiError(400, "invalid_request", `ids에는 분석 ID를 쉼표로 구분해 1~${MAX_BATCH_IDS}개 넣어 주세요.`);
    }
    const rows = (await repos.analyses.listByIds(ids)).filter((row) => row.status !== "expired");
    const snapshots = await snapshotsFor(rows);
    const found = new Map(rows.map((row) => [row.id, row]));
    return BatchSummaryResponseSchema.parse({
      items: ids.flatMap((value) => {
        const row = found.get(value);
        return row ? [toSummary(row, row.snapshotId ? snapshots.get(row.snapshotId) : undefined)] : [];
      }),
      missingIds: ids.filter((value) => !found.has(value)),
    });
  });

  app.get("/api/analyses/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    return AnalysisDetailSchema.parse(await toDetail(await load(id)));
  });

  // 분석 내역 (FR-011, FR-027, Constitution I·II). 실행 중에도 지금까지의 기록을 보여 준다.
  app.get("/api/analyses/:id/trace", async (request) => {
    const { id } = IdParams.parse(request.params);
    const row = await load(id);
    const snapshot = row.snapshotId ? await repos.snapshots.getById(row.snapshotId) : null;
    const [rounds, files] = await Promise.all([repos.rounds.listByAnalysis(row.id), repos.files.listWorkingSet(row.id)]);
    const trace: TraceResponse = {
      repo: toSummary(row, snapshot ?? undefined).repo,
      detectedStack: snapshot?.detectedStack ?? { languages: [], packageManagers: [], frameworkHints: [], manifests: [] },
      treeStats: {
        entryCount: snapshot?.treeEntryCount ?? 0,
        candidateCount: snapshot?.candidateCount ?? 0,
        truncated: snapshot?.treeTruncated ?? false,
      },
      limits: { ...row.limits },
      usage: row.usage,
      stopReason: row.stopReason,
      limitReached: isLimitStop(row.stopReason) || row.partialReasons.length > 0,
      decisions: rounds.map((round) => ({
        decideNo: round.decideNo,
        sufficient: round.sufficient,
        coverage: round.coverage,
        requests: round.requests,
        expandedDirectories: round.expandedDirectories,
      })),
      files: snapshot
        ? files.map((file) => ({
            path: file.path,
            roundNo: file.roundNo,
            source: file.source,
            reason: file.reason,
            sizeBytes: file.sizeBytes,
            truncated: file.truncated,
            contentIncludedInWrite: file.contentIncludedInWrite,
            githubUrl: blobUrl(row.repoOwner, row.repoName, snapshot.commitSha, file.path),
          }))
        : [],
    };
    return TraceResponseSchema.parse(trace);
  });

  /** 분석 커밋과 같은 ref의 최신 커밋을 비교한다 (5분 캐시). */
  async function checkFreshness(row: AnalysisRow): Promise<FreshnessResponse> {
    const snapshot = row.snapshotId ? await repos.snapshots.getById(row.snapshotId) : null;
    if (!snapshot) throw new ApiError(409, "not_ready", "분석할 커밋이 아직 정해지지 않았습니다.");
    if (!deps.freshness) throw new Error("freshness cache is not configured");
    let latest: { sha: string; checkedAt: Date };
    try {
      latest = await deps.freshness.latest(snapshot.owner, snapshot.name, snapshot.ref);
    } catch (error) {
      app.log.warn({ err: error }, "freshness check failed");
      throw new ApiError(503, "internal_error", "최신 커밋을 확인하지 못했습니다.", { action: "잠시 후 다시 시도해 주세요." });
    }
    return {
      analyzedCommitSha: snapshot.commitSha,
      latestCommitSha: latest.sha,
      isOutdated: latest.sha !== snapshot.commitSha,
      checkedAt: latest.checkedAt.toISOString(),
    };
  }

  // 새 커밋 확인 (US4 #4, US5 #2)
  app.get("/api/analyses/:id/freshness", async (request) => {
    const { id } = IdParams.parse(request.params);
    return FreshnessResponseSchema.parse(await checkFreshness(await load(id)));
  });

  // 매뉴얼 재생성 (FR-032, FR-033, research R15). 새 분석을 같은 계보(root)에 만들고 이전 매뉴얼은 그대로 둔다.
  app.post("/api/analyses/:id/regenerations", async (request, reply) => {
    const { id } = IdParams.parse(request.params);
    const parent = await load(id);
    const body = RegenerationRequestSchema.parse(request.body);
    if (parent.status !== "completed" && parent.status !== "partial") {
      throw new ApiError(409, "parent_not_finished", "분석이 끝난 결과만 다시 만들 수 있습니다.");
    }
    const at = now();
    const base = {
      repoOwner: parent.repoOwner,
      repoName: parent.repoName,
      requestedRef: parent.requestedRef,
      limits: deps.limits,
      promptVersion: PROMPT_VERSION,
      clientKeyHash: hashClientKey(request.ip, deps.clientKeySalt),
      createdAt: at,
      expiresAt: new Date(at.getTime() + deps.retentionDays * 24 * 60 * 60 * 1000),
      parentAnalysisId: parent.id,
      rootAnalysisId: parent.rootAnalysisId,
    };

    let input: NewAnalysis;
    if (body.mode === "change_options") {
      const level = body.level ?? parent.level;
      const purpose = body.purpose ?? parent.purpose;
      if (level === parent.level && purpose === parent.purpose) {
        throw new ApiError(400, "invalid_request", "수준이나 목적 중 하나 이상을 바꿔 주세요.");
      }
      // 같은 스냅샷을 쓰고, 부모가 읽은 파일을 재사용한다.
      input = { ...base, level, purpose, subpath: parent.subpath, snapshotId: parent.snapshotId, regenerationMode: "change_options" };
    } else {
      if (!(await checkFreshness(parent)).isOutdated) {
        throw new ApiError(409, "already_latest", "이미 최신 커밋으로 분석한 결과입니다.");
      }
      input = { ...base, level: parent.level, purpose: parent.purpose, subpath: null, regenerationMode: "refresh_commit" };
    }

    const { row } = await createWithQuota(input);
    return reply.code(202).send(RegenerationResponseSchema.parse({ id: row.id, status: "queued" }));
  });

  app.get("/api/analyses/:id/manual", async (request) => {
    const { id } = IdParams.parse(request.params);
    const row = await load(id);
    const manual = row.status === "completed" || row.status === "partial" ? await repos.manuals.getByAnalysisId(row.id) : null;
    if (!manual) throw new ApiError(409, "not_ready", "매뉴얼이 아직 준비되지 않았습니다.");
    return ManualSchema.parse(manual.document);
  });
}
