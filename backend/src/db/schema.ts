import {
  AnalysisStageSchema,
  AnalysisStatusSchema,
  FailureCodeSchema,
  FileSourceSchema,
  LevelSchema,
  PurposeSchema,
  RegenerationModeSchema,
  StopReasonSchema,
  type DetectedStack,
  type Manual,
  type PartialReason,
  type Progress,
  type Usage,
} from "@repoguide/shared";
import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import type { Limits } from "../config/limits.js";
import type {
  Candidate,
  CoverageEntry,
  FileNote,
  ManualStats,
  RequestRecord,
} from "./json-types.js";

// specs/001-repo-manual-generator/data-model.md를 그대로 옮긴 스키마. 모든 테이블은 RLS를 켜고 정책을 두지 않는다.

function values<T extends string>(schema: { options: readonly T[] }): [T, ...T[]] {
  return schema.options as [T, ...T[]];
}

export const levelEnum = pgEnum("level", values(LevelSchema));
export const purposeEnum = pgEnum("purpose", values(PurposeSchema));
export const analysisStatusEnum = pgEnum("analysis_status", values(AnalysisStatusSchema));
export const analysisStageEnum = pgEnum("analysis_stage", values(AnalysisStageSchema));
export const regenerationModeEnum = pgEnum("regeneration_mode", values(RegenerationModeSchema));
export const failureCodeEnum = pgEnum("failure_code", values(FailureCodeSchema));
export const stopReasonEnum = pgEnum("stop_reason", values(StopReasonSchema));
export const fileSourceEnum = pgEnum("file_source", values(FileSourceSchema));

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const repoSnapshots = pgTable(
  "repo_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    commitSha: text("commit_sha").notNull(),
    ref: text("ref").notNull(),
    defaultBranch: text("default_branch").notNull(),
    description: text("description"),
    primaryLanguage: text("primary_language"),
    treeEntryCount: integer("tree_entry_count").notNull(),
    candidateCount: integer("candidate_count").notNull(),
    treeTruncated: boolean("tree_truncated").notNull(),
    candidates: jsonb("candidates").$type<Candidate[]>().notNull(),
    detectedStack: jsonb("detected_stack").$type<DetectedStack>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("repo_snapshots_commit_unique").on(t.owner, t.name, t.commitSha),
    check("repo_snapshots_commit_sha_format", sql`${t.commitSha} ~ '^[0-9a-f]{40}$'`),
  ],
).enableRLS();

export const snapshotFiles = pgTable(
  "snapshot_files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => repoSnapshots.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    blobSha: text("blob_sha").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    content: text("content"),
    lineCount: integer("line_count").notNull(),
    truncated: boolean("truncated").notNull(),
    skippedReason: text("skipped_reason"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("snapshot_files_path_unique").on(t.snapshotId, t.path)],
).enableRLS();

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    rootAnalysisId: uuid("root_analysis_id")
      .notNull()
      .references((): AnyPgColumn => analyses.id),
    parentAnalysisId: uuid("parent_analysis_id").references((): AnyPgColumn => analyses.id),
    regenerationMode: regenerationModeEnum("regeneration_mode"),
    repoOwner: text("repo_owner").notNull(),
    repoName: text("repo_name").notNull(),
    requestedRef: text("requested_ref"),
    subpath: text("subpath"),
    snapshotId: uuid("snapshot_id").references(() => repoSnapshots.id),
    level: levelEnum("level").notNull(),
    purpose: purposeEnum("purpose").notNull(),
    status: analysisStatusEnum("status").notNull().default("queued"),
    stage: analysisStageEnum("stage").notNull().default("queued"),
    progress: jsonb("progress").$type<Progress>().notNull(),
    stopReason: stopReasonEnum("stop_reason"),
    failureCode: failureCodeEnum("failure_code"),
    failureRetryAt: timestamp("failure_retry_at", { withTimezone: true }),
    partialReasons: jsonb("partial_reasons")
      .$type<PartialReason[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    limits: jsonb("limits").$type<Limits>().notNull(),
    usage: jsonb("usage").$type<Usage>().notNull(),
    reservedCostUsd: numeric("reserved_cost_usd", { precision: 10, scale: 4 })
      .notNull()
      .default("0"),
    promptVersion: text("prompt_version").notNull(),
    clientKeyHash: text("client_key_hash").notNull(),
    leaseOwner: text("lease_owner"),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    attemptCount: integer("attempt_count").notNull().default(0),
    createdAt: createdAt(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      "analyses_failed_requires_code",
      sql`${t.status} <> 'failed' OR ${t.failureCode} IS NOT NULL`,
    ),
    check(
      "analyses_partial_requires_reasons",
      sql`${t.status} <> 'partial' OR jsonb_array_length(${t.partialReasons}) > 0`,
    ),
    check(
      "analyses_regeneration_requires_parent",
      sql`${t.regenerationMode} IS NULL OR ${t.parentAnalysisId} IS NOT NULL`,
    ),
    check("analyses_attempt_count_nonnegative", sql`${t.attemptCount} >= 0`),
    index("analyses_status_created_idx").on(t.status, t.createdAt),
    index("analyses_client_created_idx").on(t.clientKeyHash, t.createdAt),
    index("analyses_root_created_idx").on(t.rootAnalysisId, t.createdAt),
    index("analyses_expires_idx").on(t.expiresAt),
    index("analyses_inflight_dedup_idx")
      .on(t.repoOwner, t.repoName, t.requestedRef, t.level, t.purpose)
      .where(sql`${t.status} in ('queued', 'running')`),
  ],
).enableRLS();

export const explorationRounds = pgTable(
  "exploration_rounds",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    decideNo: integer("decide_no").notNull(),
    model: text("model").notNull(),
    inputFilePaths: jsonb("input_file_paths").$type<string[]>().notNull(),
    requests: jsonb("requests").$type<RequestRecord[]>().notNull(),
    expandedDirectories: jsonb("expanded_directories").$type<string[]>().notNull(),
    coverage: jsonb("coverage").$type<CoverageEntry[]>().notNull(),
    fileNotes: jsonb("file_notes").$type<FileNote[]>().notNull(),
    sufficient: boolean("sufficient").notNull(),
    usage: jsonb("usage").$type<Usage>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("exploration_rounds_decide_unique").on(t.analysisId, t.decideNo),
    check("exploration_rounds_decide_no_positive", sql`${t.decideNo} >= 1`),
  ],
).enableRLS();

export const exploredFiles = pgTable(
  "explored_files",
  {
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id, { onDelete: "cascade" }),
    snapshotFileId: uuid("snapshot_file_id")
      .notNull()
      .references(() => snapshotFiles.id),
    path: text("path").notNull(),
    roundNo: integer("round_no").notNull(),
    source: fileSourceEnum("source").notNull(),
    reason: text("reason").notNull(),
    contentIncludedInWrite: boolean("content_included_in_write").notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.analysisId, t.path] }),
    check("explored_files_round_no_nonnegative", sql`${t.roundNo} >= 0`),
  ],
).enableRLS();

export const manuals = pgTable("manuals", {
  id: uuid("id").primaryKey().defaultRandom(),
  analysisId: uuid("analysis_id")
    .notNull()
    .unique("manuals_analysis_unique")
    .references(() => analyses.id, { onDelete: "cascade" }),
  level: levelEnum("level").notNull(),
  purpose: purposeEnum("purpose").notNull(),
  document: jsonb("document").$type<Manual>().notNull(),
  stats: jsonb("stats").$type<ManualStats>().notNull(),
  model: text("model").notNull(),
  usage: jsonb("usage").$type<Usage>().notNull(),
  createdAt: createdAt(),
}).enableRLS();

export const schema = {
  levelEnum,
  purposeEnum,
  analysisStatusEnum,
  analysisStageEnum,
  regenerationModeEnum,
  failureCodeEnum,
  stopReasonEnum,
  fileSourceEnum,
  repoSnapshots,
  snapshotFiles,
  analyses,
  explorationRounds,
  exploredFiles,
  manuals,
};
