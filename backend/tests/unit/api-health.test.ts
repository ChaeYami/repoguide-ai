import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ErrorResponseSchema } from "@repoguide/shared";
import { afterAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { ApiError } from "../../src/api/errors.js";
import { buildServer } from "../../src/api/server.js";

const okDb = { ping: async () => {} };
const downDb = {
  ping: async () => {
    throw new Error("connect ECONNREFUSED postgresql://user:secret@db");
  },
};

describe("GET /api/health", () => {
  it("returns ok when the database answers", async () => {
    const app = await buildServer({ db: okDb, logger: false });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, db: "ok" });
  });

  it("returns 503 without leaking the database error", async () => {
    const app = await buildServer({ db: downDb, logger: false });
    const res = await app.inject({ method: "GET", url: "/api/health" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toEqual({ ok: false, db: "error" });
    expect(res.body).not.toContain("secret");
  });
});

describe("error handling", () => {
  async function appWithRoutes() {
    const app = await buildServer({ db: okDb, logger: false });
    app.get("/api/boom", async () => {
      throw new Error("db password=hunter2 failed at internal.ts:42");
    });
    app.get("/api/strict", async () => z.object({ n: z.number() }).parse({ n: "x" }));
    app.get("/api/domain", async () => {
      throw new ApiError(429, "rate_limited", "오늘 요청 한도에 도달했습니다.", { retryAfterSec: 120 });
    });
    return app;
  }

  it("maps unknown API routes to a 404 error envelope", async () => {
    const app = await buildServer({ db: okDb, logger: false });
    const res = await app.inject({ method: "GET", url: "/api/nope" });
    expect(res.statusCode).toBe(404);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe("not_found");
  });

  it("hides internal details behind internal_error", async () => {
    const res = await (await appWithRoutes()).inject({ method: "GET", url: "/api/boom" });
    expect(res.statusCode).toBe(500);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe("internal_error");
    expect(res.body).not.toContain("hunter2");
    expect(res.body).not.toContain("internal.ts");
  });

  it("maps validation failures to invalid_request", async () => {
    const res = await (await appWithRoutes()).inject({ method: "GET", url: "/api/strict" });
    expect(res.statusCode).toBe(400);
    expect(ErrorResponseSchema.parse(res.json()).error.code).toBe("invalid_request");
  });

  it("passes domain errors through with their code and retry hint", async () => {
    const res = await (await appWithRoutes()).inject({ method: "GET", url: "/api/domain" });
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({
      error: { code: "rate_limited", message: "오늘 요청 한도에 도달했습니다.", retryAfterSec: 120 },
    });
  });
});

describe("static frontend", () => {
  const dir = mkdtempSync(join(tmpdir(), "repoguide-static-"));
  writeFileSync(join(dir, "index.html"), "<!doctype html><title>RepoGuide AI</title>");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("serves index.html for client routes and keeps /api 404s as JSON", async () => {
    const app = await buildServer({ db: okDb, logger: false, staticDir: dir });
    const page = await app.inject({ method: "GET", url: "/a/123" });
    expect(page.statusCode).toBe(200);
    expect(page.body).toContain("RepoGuide AI");

    const api = await app.inject({ method: "GET", url: "/api/unknown" });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe("not_found");
  });
});
