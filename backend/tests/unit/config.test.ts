import { describe, expect, it } from "vitest";
import { EnvError, parseConfig } from "../../src/config/env.js";

const VALID_DB = "postgresql://postgres.abc:s3cret-pass@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres";

function issuesOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof EnvError) return error;
    throw error;
  }
  throw new Error("EnvError가 발생하지 않았습니다");
}

describe("parseConfig", () => {
  it("applies documented defaults when only required values are present", () => {
    const { env, limits } = parseConfig({ DATABASE_URL: VALID_DB }, { require: ["DATABASE_URL"] });
    expect(env).toMatchObject({
      NODE_ENV: "development",
      PORT: 8787,
      TRUST_PROXY: false,
      WORKER_CONCURRENCY: 2,
      RETENTION_DAYS: 30,
      GEMINI_MODEL_DECIDE: "gemini-3.5-flash-lite",
      GEMINI_MODEL_WRITE: "gemini-3.8-flash",
    });
    expect(limits).toEqual({
      maxRounds: 3,
      maxFiles: 40,
      maxFilesPerRound: 15,
      maxFileBytes: 200_000,
      maxCharsPerFile: 60_000,
      maxContentChars: 300_000,
      maxGithubCalls: 80,
      maxInputTokens: 400_000,
      maxOutputTokens: 60_000,
      runTimeoutSec: 600,
      maxOutputDecide: 4_000,
      maxOutputWrite: 16_000,
      maxCostUsdPerRun: 0.3,
      dailyCostUsd: 5,
      requestsPerClientPerDay: 10,
    });
  });

  it("treats blank values copied from .env.example as missing", () => {
    const error = issuesOf(() =>
      parseConfig(
        { DATABASE_URL: "", GITHUB_TOKEN: "   ", PORT: "" },
        { require: ["DATABASE_URL", "GITHUB_TOKEN"] },
      ),
    );
    expect(error.issues).toEqual([
      { name: "DATABASE_URL", problem: "값이 없습니다" },
      { name: "GITHUB_TOKEN", problem: "값이 없습니다" },
    ]);
  });

  it("lists every missing name but never echoes secret values", () => {
    const secret = "AIzaSy-THIS-MUST-NOT-LEAK";
    const error = issuesOf(() =>
      parseConfig(
        { GEMINI_API_KEY: secret, CLIENT_KEY_SALT: "short-salt-value" },
        { require: ["DATABASE_URL", "GITHUB_TOKEN", "CLIENT_KEY_SALT"] },
      ),
    );
    expect(error.issues.map((issue) => issue.name)).toEqual(["CLIENT_KEY_SALT"]);
    expect(error.message).toContain("CLIENT_KEY_SALT");
    expect(error.message).not.toContain(secret);
    expect(error.message).not.toContain("short-salt-value");
  });

  it("reports missing required names when the rest is valid", () => {
    const error = issuesOf(() =>
      parseConfig({}, { require: ["DATABASE_URL", "GITHUB_TOKEN", "CLIENT_KEY_SALT"] }),
    );
    expect(error.issues.map((issue) => issue.name)).toEqual([
      "DATABASE_URL",
      "GITHUB_TOKEN",
      "CLIENT_KEY_SALT",
    ]);
  });

  it.each([
    ["mysql://user:pass@host/db", "postgresql:// 형식"],
    ["postgresql://postgres.abc:[YOUR-PASSWORD]@host:5432/postgres", "[YOUR-PASSWORD]"],
    ["postgresql://postgres.abc:pw@host.pooler.supabase.com:6543/postgres", "Session pooler"],
  ])("rejects a misconfigured DATABASE_URL (%s) without printing it", (url, hint) => {
    const error = issuesOf(() => parseConfig({ DATABASE_URL: url }));
    expect(error.issues[0]).toMatchObject({ name: "DATABASE_URL" });
    expect(error.issues[0]!.problem).toContain(hint);
    expect(error.message).not.toContain(url);
  });

  it("parses numeric and boolean overrides", () => {
    const { env, limits } = parseConfig({
      PORT: "9000",
      TRUST_PROXY: "true",
      LIMIT_MAX_ROUNDS: "1",
      LIMIT_MAX_COST_USD_PER_RUN: "0.15",
    });
    expect(env.PORT).toBe(9000);
    expect(env.TRUST_PROXY).toBe(true);
    expect(limits.maxRounds).toBe(1);
    expect(limits.maxCostUsdPerRun).toBe(0.15);
  });

  it("rejects non-numeric and non-positive limits", () => {
    const error = issuesOf(() =>
      parseConfig({ LIMIT_MAX_FILES: "many", LIMIT_DAILY_COST_USD: "0", TRUST_PROXY: "yes" }),
    );
    expect(error.issues.map((issue) => issue.name).sort()).toEqual([
      "LIMIT_DAILY_COST_USD",
      "LIMIT_MAX_FILES",
      "TRUST_PROXY",
    ]);
  });
});
