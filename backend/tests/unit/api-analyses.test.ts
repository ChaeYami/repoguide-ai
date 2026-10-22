import { AnalysisDetailSchema, ErrorResponseSchema, FailureCodeSchema, PartialReasonSchema } from "@repoguide/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashClientKey } from "../../src/api/client-key.js";
import { FAILURE_MESSAGES, PARTIAL_MESSAGES } from "../../src/api/messages.js";
import { registerAnalysesRoutes } from "../../src/api/routes/analyses.js";
import { buildServer } from "../../src/api/server.js";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { EMPTY_USAGE } from "../../src/db/repositories/analyses.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { createPgliteDb } from "../support/pglite-db.js";

const SALT = "s".repeat(40);
let handle: DbHandle;
let repos: Repositories;

beforeAll(async () => {
  handle = await createPgliteDb();
  repos = createRepositories(handle.db);
}, 60_000);
afterAll(async () => handle.close());
beforeEach(async () => {
  await handle.db.execute(sql`truncate analyses, repo_snapshots cascade`);
});

async function app() {
  return buildServer({
    db: handle,
    logger: false,
    routes: (instance) => registerAnalysesRoutes(instance, { repos, limits: parseLimits({}), retentionDays: 30, clientKeySalt: SALT }),
  });
}

const create = async (body: Record<string, unknown>) => (await app()).inject({ method: "POST", url: "/api/analyses", payload: body });
const valid = { repoUrl: "https://github.com/Acme/Demo/tree/feature/x/packages/web", level: "beginner", purpose: "setup" };

describe("POST /api/analyses", () => {
  it("rejects a non-GitHub URL with invalid_url and a format example (FR-002)", async () => {
    const res = await create({ ...valid, repoUrl: "https://gitlab.com/a/b" });
    expect(res.statusCode).toBe(400);
    const { error } = ErrorResponseSchema.parse(res.json());
    expect(error).toMatchObject({ code: "invalid_url", message: "GitHub 저장소 주소만 지원합니다." });
    expect(error.action).toContain("https://github.com/owner/repo");
  });

  it("rejects missing level or purpose with invalid_request (FR-005)", async () => {
    const res = await create({ repoUrl: valid.repoUrl, level: "beginner" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
  });

  it("queues an analysis, keeps the raw ref segments and stores only a hashed client key", async () => {
    const res = await create(valid);
    expect(res.statusCode).toBe(202);
    const body = res.json();
    expect(body).toMatchObject({ status: "queued", deduplicated: false });
    const row = await repos.analyses.getById(body.id);
    expect(row).toMatchObject({ repoOwner: "acme", repoName: "demo", requestedRef: "feature/x/packages/web", rootAnalysisId: body.id, status: "queued" });
    expect(row!.clientKeyHash).toBe(hashClientKey("127.0.0.1", SALT));
    expect(row!.clientKeyHash).not.toContain("127.0.0.1");
    expect(row!.expiresAt.getTime() - row!.createdAt.getTime()).toBeCloseTo(30 * 24 * 3600 * 1000, -4);
  });

  it("returns the in-flight analysis for a duplicate request", async () => {
    const first = (await create(valid)).json();
    const second = (await create(valid)).json();
    expect(second).toEqual({ id: first.id, status: "queued", deduplicated: true });
    expect((await create({ ...valid, level: "developer" })).json().deduplicated).toBe(false);
  });
});

describe("GET /api/analyses/:id", () => {
  it("returns progress and queue position for queued analyses", async () => {
    const first = (await create(valid)).json();
    const second = (await create({ ...valid, purpose: "modify" })).json();
    const server = await app();
    const detail = AnalysisDetailSchema.parse((await server.inject({ method: "GET", url: `/api/analyses/${second.id}` })).json());
    expect(detail).toMatchObject({ status: "queued", stage: "queued", queuePosition: 2, failure: null, hasManual: false, regenerationMode: null });
    expect(detail.progress).toMatchObject({ round: 0, maxRounds: 3, activity: null });
    expect(detail.versions.map((v) => v.id)).toEqual([second.id]);
    expect(AnalysisDetailSchema.parse((await server.inject({ method: "GET", url: `/api/analyses/${first.id}` })).json()).queuePosition).toBe(1);
  });

  it("explains failures with the fixed message, action and retry time", async () => {
    const { id } = (await create(valid)).json();
    await repos.analyses.finish(id, { status: "failed", failureCode: "github_rate_limited", failureRetryAt: new Date(Date.now() + 120_000), usage: EMPTY_USAGE });
    const detail = (await (await app()).inject({ method: "GET", url: `/api/analyses/${id}` })).json();
    expect(detail.failure).toMatchObject({ code: "github_rate_limited", ...FAILURE_MESSAGES.github_rate_limited });
    expect(detail.failure.retryAfterSec).toBeGreaterThan(100);
    expect(detail.queuePosition).toBeNull();
  });

  it("lists partial reasons with messages", async () => {
    const { id } = (await create(valid)).json();
    await repos.analyses.finish(id, { status: "partial", stopReason: "round_limit", partialReasons: ["round_limit", "repo_too_large"], usage: EMPTY_USAGE });
    const detail = (await (await app()).inject({ method: "GET", url: `/api/analyses/${id}` })).json();
    expect(detail.partialReasons).toEqual([
      { code: "round_limit", message: PARTIAL_MESSAGES.round_limit },
      { code: "repo_too_large", message: PARTIAL_MESSAGES.repo_too_large },
    ]);
    expect(detail.hasManual).toBe(true);
  });

  it.each(["not-a-uuid", "11111111-1111-4111-8111-111111111111"])("returns 404 for unknown id %s", async (id) => {
    const res = await (await app()).inject({ method: "GET", url: `/api/analyses/${id}` });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe("not_found");
  });

  it("returns 410 for expired analyses", async () => {
    const { id } = (await create(valid)).json();
    await handle.db.execute(sql`update analyses set status = 'expired' where id = ${id}`);
    const res = await (await app()).inject({ method: "GET", url: `/api/analyses/${id}` });
    expect(res.statusCode).toBe(410);
    expect(res.json().error.code).toBe("expired");
  });
});

describe("GET /api/analyses/:id/manual", () => {
  it("returns 409 not_ready until the analysis has a manual", async () => {
    const { id } = (await create(valid)).json();
    const res = await (await app()).inject({ method: "GET", url: `/api/analyses/${id}/manual` });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe("not_ready");
  });
});

describe("messages", () => {
  it("maps every failure code and partial reason to fixed Korean text (SC-007)", () => {
    for (const code of FailureCodeSchema.options) {
      expect(FAILURE_MESSAGES[code].message).toMatch(/[가-힣]/);
      expect(FAILURE_MESSAGES[code].action).toMatch(/[가-힣]/);
    }
    for (const reason of PartialReasonSchema.options) expect(PARTIAL_MESSAGES[reason]).toMatch(/[가-힣]/);
  });
});
