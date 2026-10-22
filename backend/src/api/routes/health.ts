import type { HealthResponse } from "@repoguide/shared";
import type { FastifyInstance } from "fastify";

export function registerHealthRoutes(app: FastifyInstance, deps: { ping(): Promise<void> }) {
  app.get("/api/health", async (request, reply) => {
    try {
      await deps.ping();
      const body: HealthResponse = { ok: true, db: "ok" };
      return body;
    } catch (error) {
      request.log.warn({ err: error }, "database ping failed");
      const body: HealthResponse = { ok: false, db: "error" };
      return reply.code(503).send(body);
    }
  });
}
