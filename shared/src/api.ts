import { z } from "zod";
import {
  AnalysisStageSchema,
  AnalysisStatusSchema,
  CoverageStatusSchema,
  ErrorCodeSchema,
  FailureCodeSchema,
  FileSourceSchema,
  LevelSchema,
  PartialReasonSchema,
  ProgressActivitySchema,
  PurposeSchema,
  RegenerationModeSchema,
  RequestRejectReasonSchema,
  StopReasonSchema,
} from "./enums.js";
import { COMMIT_SHA_PATTERN } from "./manual.js";

// contracts/http-api.md의 요청·응답 계약.

export const ErrorResponseSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    action: z.string().optional(),
    retryAfterSec: z.number().int().nonnegative().optional(),
  }),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const RepoRefSchema = z.object({
  owner: z.string().min(1),
  name: z.string().min(1),
  ref: z.string().nullable(),
  commitSha: z.string().regex(COMMIT_SHA_PATTERN).nullable(),
  subpath: z.string().nullable(),
  htmlUrl: z.url(),
});
export type RepoRef = z.infer<typeof RepoRefSchema>;

export const DetectedStackSchema = z.object({
  languages: z.array(z.string()),
  packageManagers: z.array(z.string()),
  frameworkHints: z.array(z.string()),
  manifests: z.array(z.string()),
});
export type DetectedStack = z.infer<typeof DetectedStackSchema>;

export const UsageSchema = z.object({
  rounds: z.number().int().nonnegative(),
  filesRead: z.number().int().nonnegative(),
  githubCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  thoughtTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  usageEstimated: z.boolean(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const ProgressSchema = z.object({
  round: z.number().int().nonnegative(),
  maxRounds: z.number().int().nonnegative(),
  filesRead: z.number().int().nonnegative(),
  filesPlanned: z.number().int().nonnegative(),
  activity: ProgressActivitySchema.nullable(),
  updatedAt: z.iso.datetime(),
});
export type Progress = z.infer<typeof ProgressSchema>;

export const AnalysisSummarySchema = z.object({
  id: z.uuid(),
  repo: RepoRefSchema,
  level: LevelSchema,
  purpose: PurposeSchema,
  status: AnalysisStatusSchema,
  createdAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
});
export type AnalysisSummary = z.infer<typeof AnalysisSummarySchema>;

export const AnalysisDetailSchema = AnalysisSummarySchema.extend({
  stage: AnalysisStageSchema,
  progress: ProgressSchema,
  queuePosition: z.number().int().positive().nullable(),
  failure: z
    .object({
      code: FailureCodeSchema,
      message: z.string(),
      action: z.string(),
      retryAfterSec: z.number().int().nonnegative().nullable(),
    })
    .nullable(),
  partialReasons: z.array(z.object({ code: PartialReasonSchema, message: z.string() })),
  hasManual: z.boolean(),
  expiresAt: z.iso.datetime(),
  parentId: z.uuid().nullable(),
  regenerationMode: RegenerationModeSchema.nullable(),
  versions: z.array(AnalysisSummarySchema),
});
export type AnalysisDetail = z.infer<typeof AnalysisDetailSchema>;

export const CreateAnalysisRequestSchema = z.object({
  repoUrl: z.string().min(1).max(2048),
  level: LevelSchema,
  purpose: PurposeSchema,
});
export type CreateAnalysisRequest = z.infer<typeof CreateAnalysisRequestSchema>;

export const CreateAnalysisResponseSchema = z.object({
  id: z.uuid(),
  status: z.enum(["queued", "running"]),
  deduplicated: z.boolean(),
});
export type CreateAnalysisResponse = z.infer<typeof CreateAnalysisResponseSchema>;

export const TraceResponseSchema = z.object({
  repo: RepoRefSchema,
  detectedStack: DetectedStackSchema,
  treeStats: z.object({
    entryCount: z.number().int().nonnegative(),
    candidateCount: z.number().int().nonnegative(),
    truncated: z.boolean(),
  }),
  limits: z.record(z.string(), z.number()),
  usage: UsageSchema,
  stopReason: StopReasonSchema.nullable(),
  limitReached: z.boolean(),
  decisions: z.array(
    z.object({
      decideNo: z.number().int().positive(),
      sufficient: z.boolean(),
      coverage: z.array(
        z.object({ sectionId: z.string(), status: CoverageStatusSchema, note: z.string() }),
      ),
      requests: z.array(
        z.object({
          path: z.string(),
          reason: z.string(),
          accepted: z.boolean(),
          rejectReason: RequestRejectReasonSchema.nullable(),
        }),
      ),
      expandedDirectories: z.array(z.string()),
    }),
  ),
  files: z.array(
    z.object({
      path: z.string(),
      roundNo: z.number().int().nonnegative(),
      source: FileSourceSchema,
      reason: z.string(),
      sizeBytes: z.number().int().nonnegative(),
      truncated: z.boolean(),
      contentIncludedInWrite: z.boolean(),
      githubUrl: z.url(),
    }),
  ),
});
export type TraceResponse = z.infer<typeof TraceResponseSchema>;

export const FreshnessResponseSchema = z.object({
  analyzedCommitSha: z.string().regex(COMMIT_SHA_PATTERN),
  latestCommitSha: z.string().regex(COMMIT_SHA_PATTERN),
  isOutdated: z.boolean(),
  checkedAt: z.iso.datetime(),
});
export type FreshnessResponse = z.infer<typeof FreshnessResponseSchema>;

export const RegenerationRequestSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("change_options"),
    level: LevelSchema.optional(),
    purpose: PurposeSchema.optional(),
  }),
  z.object({ mode: z.literal("refresh_commit") }),
]);
export type RegenerationRequest = z.infer<typeof RegenerationRequestSchema>;

export const RegenerationResponseSchema = z.object({
  id: z.uuid(),
  status: z.literal("queued"),
});
export type RegenerationResponse = z.infer<typeof RegenerationResponseSchema>;

export const BatchSummaryResponseSchema = z.object({
  items: z.array(AnalysisSummarySchema),
  missingIds: z.array(z.uuid()),
});
export type BatchSummaryResponse = z.infer<typeof BatchSummaryResponseSchema>;

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.enum(["ok", "error"]),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
