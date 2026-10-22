import { z } from "zod";
import { EnvError, issuesFromZod } from "./errors.js";

// 분석 한도 (Constitution VI, research.md R5). 실행 시작 시 이 값을 analyses.limits에 스냅샷한다.

const positiveInt = (fallback: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().int().positive().default(fallback),
  );

const positiveNumber = (fallback: number) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.coerce.number().positive().default(fallback),
  );

const LimitsSchema = z
  .object({
    LIMIT_MAX_ROUNDS: positiveInt(3),
    LIMIT_MAX_FILES: positiveInt(40),
    LIMIT_MAX_FILES_PER_ROUND: positiveInt(15),
    LIMIT_MAX_FILE_BYTES: positiveInt(200_000),
    LIMIT_MAX_CHARS_PER_FILE: positiveInt(60_000),
    LIMIT_MAX_CONTENT_CHARS: positiveInt(300_000),
    LIMIT_MAX_GITHUB_CALLS: positiveInt(80),
    LIMIT_MAX_INPUT_TOKENS: positiveInt(400_000),
    LIMIT_MAX_OUTPUT_TOKENS: positiveInt(60_000),
    LIMIT_RUN_TIMEOUT_SEC: positiveInt(600),
    LLM_MAX_OUTPUT_DECIDE: positiveInt(4_000),
    LLM_MAX_OUTPUT_WRITE: positiveInt(16_000),
    LIMIT_MAX_COST_USD_PER_RUN: positiveNumber(0.3),
    LIMIT_DAILY_COST_USD: positiveNumber(5),
    LIMIT_REQUESTS_PER_CLIENT_PER_DAY: positiveInt(10),
  })
  .transform((raw) => ({
    maxRounds: raw.LIMIT_MAX_ROUNDS,
    maxFiles: raw.LIMIT_MAX_FILES,
    maxFilesPerRound: raw.LIMIT_MAX_FILES_PER_ROUND,
    maxFileBytes: raw.LIMIT_MAX_FILE_BYTES,
    maxCharsPerFile: raw.LIMIT_MAX_CHARS_PER_FILE,
    maxContentChars: raw.LIMIT_MAX_CONTENT_CHARS,
    maxGithubCalls: raw.LIMIT_MAX_GITHUB_CALLS,
    maxInputTokens: raw.LIMIT_MAX_INPUT_TOKENS,
    maxOutputTokens: raw.LIMIT_MAX_OUTPUT_TOKENS,
    runTimeoutSec: raw.LIMIT_RUN_TIMEOUT_SEC,
    maxOutputDecide: raw.LLM_MAX_OUTPUT_DECIDE,
    maxOutputWrite: raw.LLM_MAX_OUTPUT_WRITE,
    maxCostUsdPerRun: raw.LIMIT_MAX_COST_USD_PER_RUN,
    dailyCostUsd: raw.LIMIT_DAILY_COST_USD,
    requestsPerClientPerDay: raw.LIMIT_REQUESTS_PER_CLIENT_PER_DAY,
  }));

export type Limits = z.output<typeof LimitsSchema>;

export function parseLimits(source: Record<string, string | undefined>): Limits {
  const result = LimitsSchema.safeParse(source);
  if (!result.success) throw new EnvError(issuesFromZod(result.error));
  return result.data;
}
