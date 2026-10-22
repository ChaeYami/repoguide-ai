CREATE TYPE "public"."analysis_stage" AS ENUM('queued', 'validating_repo', 'scanning_structure', 'selecting_files', 'reading_files', 'exploring_more', 'writing_manual', 'done');--> statement-breakpoint
CREATE TYPE "public"."analysis_status" AS ENUM('queued', 'running', 'completed', 'partial', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."failure_code" AS ENUM('invalid_url', 'repo_not_found_or_private', 'repo_empty', 'ref_not_found', 'no_analyzable_files', 'limit_reached', 'github_rate_limited', 'github_unavailable', 'llm_rate_limited', 'llm_unavailable', 'manual_generation_failed', 'timeout', 'internal_error');--> statement-breakpoint
CREATE TYPE "public"."file_source" AS ENUM('seed', 'llm_request', 'reused');--> statement-breakpoint
CREATE TYPE "public"."level" AS ENUM('beginner', 'vibe_coder', 'developer');--> statement-breakpoint
CREATE TYPE "public"."purpose" AS ENUM('understand', 'setup', 'modify');--> statement-breakpoint
CREATE TYPE "public"."regeneration_mode" AS ENUM('change_options', 'refresh_commit');--> statement-breakpoint
CREATE TYPE "public"."stop_reason" AS ENUM('sufficient', 'no_more_candidates', 'round_limit', 'file_limit', 'cost_limit', 'token_limit', 'github_call_limit', 'timeout');--> statement-breakpoint
CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"root_analysis_id" uuid NOT NULL,
	"parent_analysis_id" uuid,
	"regeneration_mode" "regeneration_mode",
	"repo_owner" text NOT NULL,
	"repo_name" text NOT NULL,
	"requested_ref" text,
	"subpath" text,
	"snapshot_id" uuid,
	"level" "level" NOT NULL,
	"purpose" "purpose" NOT NULL,
	"status" "analysis_status" DEFAULT 'queued' NOT NULL,
	"stage" "analysis_stage" DEFAULT 'queued' NOT NULL,
	"progress" jsonb NOT NULL,
	"stop_reason" "stop_reason",
	"failure_code" "failure_code",
	"failure_retry_at" timestamp with time zone,
	"partial_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"usage" jsonb NOT NULL,
	"reserved_cost_usd" numeric(10, 4) DEFAULT '0' NOT NULL,
	"prompt_version" text NOT NULL,
	"client_key_hash" text NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "analyses_failed_requires_code" CHECK ("analyses"."status" <> 'failed' OR "analyses"."failure_code" IS NOT NULL),
	CONSTRAINT "analyses_partial_requires_reasons" CHECK ("analyses"."status" <> 'partial' OR jsonb_array_length("analyses"."partial_reasons") > 0),
	CONSTRAINT "analyses_regeneration_requires_parent" CHECK ("analyses"."regeneration_mode" IS NULL OR "analyses"."parent_analysis_id" IS NOT NULL),
	CONSTRAINT "analyses_attempt_count_nonnegative" CHECK ("analyses"."attempt_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "analyses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "exploration_rounds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"decide_no" integer NOT NULL,
	"model" text NOT NULL,
	"input_file_paths" jsonb NOT NULL,
	"requests" jsonb NOT NULL,
	"expanded_directories" jsonb NOT NULL,
	"coverage" jsonb NOT NULL,
	"file_notes" jsonb NOT NULL,
	"sufficient" boolean NOT NULL,
	"usage" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exploration_rounds_decide_unique" UNIQUE("analysis_id","decide_no"),
	CONSTRAINT "exploration_rounds_decide_no_positive" CHECK ("exploration_rounds"."decide_no" >= 1)
);
--> statement-breakpoint
ALTER TABLE "exploration_rounds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "explored_files" (
	"analysis_id" uuid NOT NULL,
	"snapshot_file_id" uuid NOT NULL,
	"path" text NOT NULL,
	"round_no" integer NOT NULL,
	"source" "file_source" NOT NULL,
	"reason" text NOT NULL,
	"content_included_in_write" boolean DEFAULT false NOT NULL,
	CONSTRAINT "explored_files_analysis_id_path_pk" PRIMARY KEY("analysis_id","path"),
	CONSTRAINT "explored_files_round_no_nonnegative" CHECK ("explored_files"."round_no" >= 0)
);
--> statement-breakpoint
ALTER TABLE "explored_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "manuals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"level" "level" NOT NULL,
	"purpose" "purpose" NOT NULL,
	"document" jsonb NOT NULL,
	"stats" jsonb NOT NULL,
	"model" text NOT NULL,
	"usage" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manuals_analysis_unique" UNIQUE("analysis_id")
);
--> statement-breakpoint
ALTER TABLE "manuals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "repo_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner" text NOT NULL,
	"name" text NOT NULL,
	"commit_sha" text NOT NULL,
	"ref" text NOT NULL,
	"default_branch" text NOT NULL,
	"description" text,
	"primary_language" text,
	"tree_entry_count" integer NOT NULL,
	"candidate_count" integer NOT NULL,
	"tree_truncated" boolean NOT NULL,
	"candidates" jsonb NOT NULL,
	"detected_stack" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_snapshots_commit_unique" UNIQUE("owner","name","commit_sha"),
	CONSTRAINT "repo_snapshots_commit_sha_format" CHECK ("repo_snapshots"."commit_sha" ~ '^[0-9a-f]{40}$')
);
--> statement-breakpoint
ALTER TABLE "repo_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "snapshot_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"path" text NOT NULL,
	"blob_sha" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"content" text,
	"line_count" integer NOT NULL,
	"truncated" boolean NOT NULL,
	"skipped_reason" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "snapshot_files_path_unique" UNIQUE("snapshot_id","path")
);
--> statement-breakpoint
ALTER TABLE "snapshot_files" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_root_analysis_id_analyses_id_fk" FOREIGN KEY ("root_analysis_id") REFERENCES "public"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_parent_analysis_id_analyses_id_fk" FOREIGN KEY ("parent_analysis_id") REFERENCES "public"."analyses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_snapshot_id_repo_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repo_snapshots"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exploration_rounds" ADD CONSTRAINT "exploration_rounds_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explored_files" ADD CONSTRAINT "explored_files_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explored_files" ADD CONSTRAINT "explored_files_snapshot_file_id_snapshot_files_id_fk" FOREIGN KEY ("snapshot_file_id") REFERENCES "public"."snapshot_files"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manuals" ADD CONSTRAINT "manuals_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "snapshot_files" ADD CONSTRAINT "snapshot_files_snapshot_id_repo_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."repo_snapshots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_status_created_idx" ON "analyses" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "analyses_client_created_idx" ON "analyses" USING btree ("client_key_hash","created_at");--> statement-breakpoint
CREATE INDEX "analyses_root_created_idx" ON "analyses" USING btree ("root_analysis_id","created_at");--> statement-breakpoint
CREATE INDEX "analyses_expires_idx" ON "analyses" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "analyses_inflight_dedup_idx" ON "analyses" USING btree ("repo_owner","repo_name","requested_ref","level","purpose") WHERE "analyses"."status" in ('queued', 'running');