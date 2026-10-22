import { z } from "zod";

// 값은 specs/001-repo-manual-generator/data-model.md의 Enum 표와 contracts/http-api.md를 그대로 따른다.

export const LevelSchema = z.enum(["beginner", "vibe_coder", "developer"]);
export type Level = z.infer<typeof LevelSchema>;

export const PurposeSchema = z.enum(["understand", "setup", "modify"]);
export type Purpose = z.infer<typeof PurposeSchema>;

export const AnalysisStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "partial",
  "failed",
  "expired",
]);
export type AnalysisStatus = z.infer<typeof AnalysisStatusSchema>;

export const AnalysisStageSchema = z.enum([
  "queued",
  "validating_repo",
  "scanning_structure",
  "selecting_files",
  "reading_files",
  "exploring_more",
  "writing_manual",
  "done",
]);
export type AnalysisStage = z.infer<typeof AnalysisStageSchema>;

export const ProgressActivitySchema = z.enum([
  "reading_files",
  "llm_deciding",
  "llm_writing",
  "llm_retry_wait",
  "validating_citations",
]);
export type ProgressActivity = z.infer<typeof ProgressActivitySchema>;

export const RegenerationModeSchema = z.enum(["change_options", "refresh_commit"]);
export type RegenerationMode = z.infer<typeof RegenerationModeSchema>;

export const FailureCodeSchema = z.enum([
  "invalid_url",
  "repo_not_found_or_private",
  "repo_empty",
  "ref_not_found",
  "no_analyzable_files",
  "limit_reached",
  "github_rate_limited",
  "github_unavailable",
  "llm_rate_limited",
  "llm_unavailable",
  "manual_generation_failed",
  "timeout",
  "internal_error",
]);
export type FailureCode = z.infer<typeof FailureCodeSchema>;

export const PartialReasonSchema = z.enum([
  "round_limit",
  "file_limit",
  "cost_limit",
  "token_limit",
  "github_call_limit",
  "timeout",
  "repo_too_large",
  "content_trimmed",
]);
export type PartialReason = z.infer<typeof PartialReasonSchema>;

export const StopReasonSchema = z.enum([
  "sufficient",
  "no_more_candidates",
  "round_limit",
  "file_limit",
  "cost_limit",
  "token_limit",
  "github_call_limit",
  "timeout",
]);
export type StopReason = z.infer<typeof StopReasonSchema>;

export const FileSourceSchema = z.enum(["seed", "llm_request", "reused"]);
export type FileSource = z.infer<typeof FileSourceSchema>;

export const RequestRejectReasonSchema = z.enum([
  "not_in_tree",
  "not_a_file",
  "excluded",
  "too_large",
  "already_read",
  "over_round_limit",
  "over_file_limit",
  "budget",
]);
export type RequestRejectReason = z.infer<typeof RequestRejectReasonSchema>;

export const CoverageStatusSchema = z.enum(["covered", "partial", "missing"]);
export type CoverageStatus = z.infer<typeof CoverageStatusSchema>;

// HTTP 오류 응답 코드 (contracts/http-api.md 공통 오류 표)
export const ErrorCodeSchema = z.enum([
  "invalid_url",
  "invalid_request",
  "not_found",
  "not_ready",
  "already_latest",
  "parent_not_finished",
  "expired",
  "rate_limited",
  "daily_budget_exhausted",
  "internal_error",
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
