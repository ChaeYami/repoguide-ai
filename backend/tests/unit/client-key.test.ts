import { ErrorResponseSchema } from "@repoguide/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { hashClientKey } from "../../src/api/client-key.js";
import { dailyBudgetRetryAfterSec, kstDayStart, rateLimitRetryAfterSec } from "../../src/api/quota.js";
import { registerAnalysesRoutes } from "../../src/api/routes/analyses.js";
import { buildServer } from "../../src/api/server.js";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { EMPTY_USAGE } from "../../src/db/repositories/analyses.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { createPgliteDb } from "../support/pglite-db.js";

// 사용량 보호 (T035, FR-034, FR-035, research R5·R16).

const SALT = "s".repeat(40);

describe("quota time math (Asia/Seoul)", () => {
  it.each([
    ["2026-10-22T03:00:00Z", "2026-10-21T15:00:00.000Z"], // KST 12:00 → 그날 KST 00:00
    ["2026-10-22T14:59:59Z", "2026-10-21T15:00:00.000Z"], // KST 23:59:59
    ["2026-10-22T15:00:00Z", "2026-10-22T15:00:00.000Z"], // KST 다음 날 00:00
  ])("day start for %s is %s", (now, start) => {
    expect(kstDayStart(new Date(now)).toISOString()).toBe(start);
  });

  it("waits until the next KST midnight for the daily budget", () => {
    expect(dailyBudgetRetryAfterSec(new Date("2026-10-22T14:59:00Z"))).toBe(60);
    expect(dailyBudgetRetryAfterSec(new Date("2026-10-22T15:00:00Z"))).toBe(24 * 3600);
  });

  it("waits until the oldest request leaves the 24-hour window", () => {
    const now = new Date("2026-10-22T12:00:00Z");
    expect(rateLimitRetryAfterSec(new Date("2026-10-21T13:00:00Z"), now)).toBe(3600);
    expect(rateLimitRetryAfterSec(new Date("2026-10-21T12:00:00Z"), now)).toBe(1);
  });
});

let handle: DbHandle;
let repos: Repositories;
let clock = new Date("2026-10-22T03:00:00Z");

beforeAll(async () => {
  handle = await createPgliteDb();
  repos = createRepositories(handle.db);
}, 60_000);
afterAll(async () => handle.close());
beforeEach(async () => {
  clock = new Date("2026-10-22T03:00:00Z");
  await handle.db.execute(sql`truncate analyses, repo_snapshots cascade`);
});

async function app(limits: Record<string, string> = {}, trustProxy = false) {
  return buildServer({
    db: handle,
    logger: false,
    trustProxy,
    routes: (instance) =>
      registerAnalysesRoutes(instance, { repos, limits: parseLimits(limits), retentionDays: 30, clientKeySalt: SALT, now: () => clock }),
  });
}

const post = (server: Awaited<ReturnType<typeof app>>, repo: string, headers: Record<string, string> = {}) =>
  server.inject({ method: "POST", url: "/api/analyses", headers, payload: { repoUrl: `https://github.com/acme/${repo}`, level: "beginner", purpose: "setup" } });

describe("POST /api/analyses usage protection", () => {
  it("rejects the request over the per-client limit with 429 and a retry time", async () => {
    const server = await app({ LIMIT_REQUESTS_PER_CLIENT_PER_DAY: "2" });
    expect((await post(server, "a")).statusCode).toBe(202);
    clock = new Date(clock.getTime() + 3600_000);
    expect((await post(server, "b")).statusCode).toBe(202);
    const rejected = await post(server, "c");
    expect(rejected.statusCode).toBe(429);
    const { error } = ErrorResponseSchema.parse(rejected.json());
    expect(error).toMatchObject({ code: "rate_limited" });
    expect(error.message).toContain("24시간에 2회");
    // 첫 요청(1시간 전)이 24시간 창을 벗어날 때까지 23시간
    expect(error.retryAfterSec).toBe(23 * 3600);
  });

  it("does not count deduplicated requests", async () => {
    const server = await app({ LIMIT_REQUESTS_PER_CLIENT_PER_DAY: "1" });
    const first = (await post(server, "a")).json();
    const again = await post(server, "a");
    expect(again.statusCode).toBe(202);
    expect(again.json()).toMatchObject({ id: first.id, deduplicated: true });
  });

  it("counts requests per client, using X-Forwarded-For only when TRUST_PROXY is on", async () => {
    const proxied = await app({ LIMIT_REQUESTS_PER_CLIENT_PER_DAY: "1" }, true);
    expect((await post(proxied, "a", { "x-forwarded-for": "203.0.113.5" })).statusCode).toBe(202);
    expect((await post(proxied, "b", { "x-forwarded-for": "198.51.100.7" })).statusCode).toBe(202);
    expect((await post(proxied, "c", { "x-forwarded-for": "203.0.113.5" })).statusCode).toBe(429);
    const rows = await handle.db.execute(sql`select distinct client_key_hash from analyses`);
    expect((rows as unknown as { rows: { client_key_hash: string }[] }).rows.map((r) => r.client_key_hash).sort()).toEqual(
      [hashClientKey("203.0.113.5", SALT), hashClientKey("198.51.100.7", SALT)].sort(),
    );

    // 프록시를 믿지 않으면 헤더를 바꿔도 같은 출처로 센다.
    await handle.db.execute(sql`truncate analyses cascade`);
    const direct = await app({ LIMIT_REQUESTS_PER_CLIENT_PER_DAY: "1" }, false);
    expect((await post(direct, "a", { "x-forwarded-for": "203.0.113.5" })).statusCode).toBe(202);
    expect((await post(direct, "b", { "x-forwarded-for": "198.51.100.7" })).statusCode).toBe(429);
  });

  it("reserves the per-run cap and refuses new work when the daily budget would be exceeded (503)", async () => {
    // 하루 $1, 실행당 $0.30 → 진행 중 3건(예약 $0.90)이면 네 번째는 거절
    const server = await app({ LIMIT_DAILY_COST_USD: "1", LIMIT_MAX_COST_USD_PER_RUN: "0.30" });
    for (const repo of ["a", "b", "c"]) expect((await post(server, repo)).statusCode).toBe(202);
    const rejected = await post(server, "d");
    expect(rejected.statusCode).toBe(503);
    const { error } = ErrorResponseSchema.parse(rejected.json());
    expect(error.code).toBe("daily_budget_exhausted");
    expect(error.retryAfterSec).toBe(12 * 3600); // KST 12:00 → 자정까지
  });

  it("releases the reservation when an analysis finishes and counts actual spend instead", async () => {
    const server = await app({ LIMIT_DAILY_COST_USD: "1", LIMIT_MAX_COST_USD_PER_RUN: "0.30" });
    const ids = [];
    for (const repo of ["a", "b", "c"]) ids.push((await post(server, repo)).json().id as string);
    for (const id of ids) await repos.analyses.finish(id, { status: "completed", stopReason: "sufficient", usage: { ...EMPTY_USAGE, costUsd: 0.05 } });
    const reserved = await handle.db.execute(sql`select sum(reserved_cost_usd)::float as total from analyses`);
    expect((reserved as unknown as { rows: { total: number }[] }).rows[0]!.total).toBe(0);
    // 실제 지출 $0.15 + 새 예약 $0.30 ≤ $1
    expect((await post(server, "d")).statusCode).toBe(202);
  });

  it("starts a fresh daily budget after KST midnight", async () => {
    const server = await app({ LIMIT_DAILY_COST_USD: "0.5", LIMIT_MAX_COST_USD_PER_RUN: "0.30" });
    const { id } = (await post(server, "a")).json();
    await repos.analyses.finish(id, { status: "completed", stopReason: "sufficient", usage: { ...EMPTY_USAGE, costUsd: 0.3 } });
    await handle.db.execute(sql`update analyses set finished_at = ${clock.toISOString()}`);
    expect((await post(server, "b")).statusCode).toBe(503);
    clock = new Date("2026-10-22T15:00:01Z"); // KST 다음 날 00:00:01
    expect((await post(server, "c")).statusCode).toBe(202);
  });
});

describe("duplicate requests", () => {
  it("returns one analysis for simultaneous identical requests (V16 race)", async () => {
    const server = await app();
    const [a, b, c] = await Promise.all([post(server, "same"), post(server, "same"), post(server, "same")]);
    const ids = new Set([a.json().id, b.json().id, c.json().id]);
    expect(ids.size).toBe(1);
    expect([a, b, c].filter((res) => res.json().deduplicated)).toHaveLength(2);
    const rows = await handle.db.execute(sql`select count(*)::int as n from analyses`);
    expect((rows as unknown as { rows: { n: number }[] }).rows[0]!.n).toBe(1);
  });
});
