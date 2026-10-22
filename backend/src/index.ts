import { fileURLToPath } from "node:url";
import { registerAnalysesRoutes } from "./api/routes/analyses.js";
import { buildServer, REDACT_PATHS } from "./api/server.js";
import { EnvError, loadConfig } from "./config/env.js";
import { priceFor } from "./config/pricing.js";
import { createPostgresDb } from "./db/client.js";
import { createRepositories } from "./db/repositories/index.js";
import { GitHubClient } from "./github/client.js";
import { createWorker } from "./jobs/worker.js";
import { GeminiClient } from "./llm/gemini-client.js";
import { runAnalysis } from "./pipeline/run-analysis.js";

// 서버 진입점: 환경 변수 → DB → API 서버 + 인프로세스 분석 워커 (research R10, R22).

const FRONTEND_DIST = fileURLToPath(new URL("../../frontend/dist", import.meta.url));

function loggerOptions(nodeEnv: string) {
  const base = { level: nodeEnv === "production" ? "info" : "debug", redact: { paths: REDACT_PATHS, censor: "[redacted]" } };
  if (nodeEnv === "production") return base;
  return { ...base, transport: { target: "pino-pretty", options: { translateTime: "HH:MM:ss", ignore: "pid,hostname" } } };
}

async function main() {
  const { env, limits } = loadConfig({ require: ["DATABASE_URL", "GEMINI_API_KEY", "GITHUB_TOKEN", "CLIENT_KEY_SALT"] });
  // 가격표에 없는 모델이면 비용 상한을 강제할 수 없으므로 시작하지 않는다.
  priceFor(env.GEMINI_MODEL_DECIDE);
  priceFor(env.GEMINI_MODEL_WRITE);

  const db = createPostgresDb(env.DATABASE_URL!);
  const repos = createRepositories(db.db);
  const llm = new GeminiClient({ apiKey: env.GEMINI_API_KEY! });

  const app = await buildServer({
    db,
    logger: loggerOptions(env.NODE_ENV),
    staticDir: env.NODE_ENV === "production" ? FRONTEND_DIST : undefined,
    trustProxy: env.TRUST_PROXY,
    routes: (instance) =>
      registerAnalysesRoutes(instance, {
        repos,
        limits,
        retentionDays: env.RETENTION_DAYS,
        clientKeySalt: env.CLIENT_KEY_SALT!,
      }),
  });

  const worker = createWorker({
    analyses: repos.analyses,
    concurrency: env.WORKER_CONCURRENCY,
    runTimeoutMs: limits.runTimeoutSec * 1000,
    logger: app.log,
    handler: (analysis, signal) =>
      runAnalysis(analysis, signal, {
        repos,
        llm,
        github: (onCall) => new GitHubClient({ token: env.GITHUB_TOKEN, onCall }),
        models: { decide: env.GEMINI_MODEL_DECIDE, write: env.GEMINI_MODEL_WRITE },
        logger: app.log,
      }),
  });

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, "shutting down");
    await worker.stop();
    await app.close();
    await db.close();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  // 개발 중에는 외부에 열지 않는다(Windows 방화벽 팝업 방지). 배포 시 0.0.0.0.
  const host = env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
  await app.listen({ port: env.PORT, host });

  try {
    await db.ping();
    app.log.info("database connection ok");
  } catch (error) {
    app.log.warn({ err: error }, "database is not reachable yet — check DATABASE_URL (GET /api/health)");
  }
  worker.start();
}

main().catch((error: unknown) => {
  console.error(error instanceof EnvError ? error.message : error);
  process.exit(1);
});
