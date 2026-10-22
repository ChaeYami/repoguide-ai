import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { EnvError, type EnvIssue, issuesFromZod } from "./errors.js";
import { type Limits, parseLimits } from "./limits.js";

export { EnvError, type EnvIssue } from "./errors.js";

// 환경 변수는 진입점마다 필요한 것만 필수로 요구한다(서버: DATABASE_URL, dev:ingest: 없음 등).
// 오류 메시지에는 변수 이름과 문제만 담고 값은 절대 출력하지 않는다.

const ROOT_ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));

const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const optionalSecret = z.preprocess(blankToUndefined, z.string().trim().optional());

const databaseUrl = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .refine((value) => /^postgres(ql)?:\/\//.test(value), "postgresql:// 형식이어야 합니다")
    .refine(
      (value) => !value.includes("[YOUR-PASSWORD]"),
      "[YOUR-PASSWORD] 자리를 실제 DB 비밀번호로 바꿔야 합니다",
    )
    .refine(
      (value) => !/:6543(\/|$)/.test(value),
      "Transaction pooler(6543) 대신 Session pooler(5432) 또는 Direct 연결을 사용해야 합니다",
    )
    .optional(),
);

const booleanString = z.preprocess(
  blankToUndefined,
  z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
);

const EnvSchema = z.object({
  NODE_ENV: z.preprocess(
    blankToUndefined,
    z.enum(["development", "test", "production"]).default("development"),
  ),
  GEMINI_API_KEY: optionalSecret,
  GITHUB_TOKEN: optionalSecret,
  DATABASE_URL: databaseUrl,
  TEST_DATABASE_URL: databaseUrl,
  CLIENT_KEY_SALT: z.preprocess(
    blankToUndefined,
    z.string().trim().min(32, "32자 이상이어야 합니다").optional(),
  ),
  GEMINI_MODEL_DECIDE: z.preprocess(blankToUndefined, z.string().default("gemini-3.5-flash-lite")),
  GEMINI_MODEL_WRITE: z.preprocess(blankToUndefined, z.string().default("gemini-3.8-flash")),
  PORT: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(65535).default(8787)),
  TRUST_PROXY: booleanString,
  WORKER_CONCURRENCY: z.preprocess(
    blankToUndefined,
    z.coerce.number().int().min(1).max(16).default(2),
  ),
  RETENTION_DAYS: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).default(30)),
});

export type Env = z.infer<typeof EnvSchema>;
export type SecretKey = "GEMINI_API_KEY" | "GITHUB_TOKEN" | "DATABASE_URL" | "TEST_DATABASE_URL" | "CLIENT_KEY_SALT";

export interface Config {
  env: Env;
  limits: Limits;
}

export function parseConfig(
  source: Record<string, string | undefined>,
  options: { require?: readonly SecretKey[] } = {},
): Config {
  const issues: EnvIssue[] = [];

  const envResult = EnvSchema.safeParse(source);
  if (!envResult.success) issues.push(...issuesFromZod(envResult.error));

  let limits: Limits | undefined;
  try {
    limits = parseLimits(source);
  } catch (error) {
    if (error instanceof EnvError) issues.push(...error.issues);
    else throw error;
  }

  if (envResult.success) {
    for (const key of options.require ?? []) {
      if (envResult.data[key] === undefined) issues.push({ name: key, problem: "값이 없습니다" });
    }
  }

  if (issues.length > 0 || !envResult.success || limits === undefined) throw new EnvError(issues);
  return { env: envResult.data, limits };
}

/** 루트 .env(있으면)를 읽은 뒤 검증한다. 이미 설정된 프로세스 환경 변수가 우선한다. */
export function loadConfig(options: { require?: readonly SecretKey[] } = {}): Config {
  if (existsSync(ROOT_ENV_FILE)) {
    const fromProcess = { ...process.env };
    process.loadEnvFile(ROOT_ENV_FILE);
    Object.assign(process.env, fromProcess);
  }
  return parseConfig(process.env, options);
}
