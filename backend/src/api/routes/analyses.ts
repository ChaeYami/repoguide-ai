import {
  type AnalysisDetail,
  AnalysisDetailSchema,
  type AnalysisSummary,
  CreateAnalysisRequestSchema,
  CreateAnalysisResponseSchema,
  ManualSchema,
  parseRepoUrl,
} from "@repoguide/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Limits } from "../../config/limits.js";
import type { AnalysisRow } from "../../db/repositories/analyses.js";
import type { Repositories } from "../../db/repositories/index.js";
import type { SnapshotRow } from "../../db/repositories/snapshots.js";
import { analysisFromUrl } from "../../pipeline/new-analysis.js";
import { hashClientKey } from "../client-key.js";
import { ApiError } from "../errors.js";
import { FAILURE_MESSAGES, PARTIAL_MESSAGES } from "../messages.js";

// 분석 시작·상태·매뉴얼 조회 (contracts/http-api.md, FR-001~FR-005, FR-018, FR-028, FR-031).

export interface AnalysesRouteDeps {
  repos: Repositories;
  limits: Limits;
  retentionDays: number;
  clientKeySalt: string;
  now?: () => Date;
}

const IdParams = z.object({ id: z.string() });

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

    const inflight = await repos.analyses.findInflight(input);
    if (inflight) {
      return reply
        .code(202)
        .send(CreateAnalysisResponseSchema.parse({ id: inflight.id, status: inflight.status, deduplicated: true }));
    }
    const created = await repos.analyses.create(input);
    return reply.code(202).send(CreateAnalysisResponseSchema.parse({ id: created.id, status: "queued", deduplicated: false }));
  });

  app.get("/api/analyses/:id", async (request) => {
    const { id } = IdParams.parse(request.params);
    return AnalysisDetailSchema.parse(await toDetail(await load(id)));
  });

  app.get("/api/analyses/:id/manual", async (request) => {
    const { id } = IdParams.parse(request.params);
    const row = await load(id);
    const manual = row.status === "completed" || row.status === "partial" ? await repos.manuals.getByAnalysisId(row.id) : null;
    if (!manual) throw new ApiError(409, "not_ready", "매뉴얼이 아직 준비되지 않았습니다.");
    return ManualSchema.parse(manual.document);
  });
}
