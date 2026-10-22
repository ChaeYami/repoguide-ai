import { existsSync } from "node:fs";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyServerOptions } from "fastify";
import { ZodError } from "zod";
import { ApiError, COMMON_ERRORS, errorBody } from "./errors.js";
import { registerHealthRoutes } from "./routes/health.js";

export interface ServerDeps {
  db: { ping(): Promise<void> };
  logger: FastifyServerOptions["logger"];
  /** 빌드된 프론트엔드(frontend/dist). 있으면 정적 서빙과 SPA fallback을 켠다. */
  staticDir?: string;
  /** 프록시 뒤 배포 시 X-Forwarded-For를 신뢰한다 (TRUST_PROXY) */
  trustProxy?: boolean;
  /** 도메인 라우트 등록 (분석 API 등) */
  routes?: (app: FastifyInstance) => void;
}

// 로그에 비밀값이 남지 않도록 인증 관련 헤더를 가린다.
export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  'req.headers["x-api-key"]',
];

export async function buildServer(deps: ServerDeps) {
  const app = Fastify({ logger: deps.logger, trustProxy: deps.trustProxy ?? false });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ApiError) {
      return reply.code(error.statusCode).send(errorBody(error.code, error.message, error.extra));
    }
    const statusCode = (error as { statusCode?: number }).statusCode;
    if (error instanceof ZodError || (error as { validation?: unknown }).validation) {
      return reply.code(400).send(COMMON_ERRORS.invalidRequest());
    }
    if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
      return reply.code(statusCode).send(COMMON_ERRORS.invalidRequest());
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send(COMMON_ERRORS.internal());
  });

  const staticDir = deps.staticDir && existsSync(deps.staticDir) ? deps.staticDir : undefined;
  if (staticDir) {
    await app.register(fastifyStatic, { root: staticDir, wildcard: false });
  }

  app.setNotFoundHandler((request, reply) => {
    const isApi = request.url === "/api" || request.url.startsWith("/api/");
    if (!isApi && staticDir && request.method === "GET") {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send(COMMON_ERRORS.notFound());
  });

  registerHealthRoutes(app, deps.db);
  deps.routes?.(app);

  return app;
}
