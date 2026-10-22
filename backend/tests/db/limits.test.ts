import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { quotaFor } from "../../src/api/quota.js";
import { parseLimits } from "../../src/config/limits.js";
import { createPostgresDb } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { requireTestDatabaseUrl } from "./test-database.js";

// 실제 Postgres에서 동시 요청이 함께 상한을 넘지 않는지 확인한다(T035). PGlite는 연결이 하나라 검증할 수 없다.

let handle: ReturnType<typeof createPostgresDb>;
let repos: Repositories;

beforeAll(async () => {
  handle = createPostgresDb(requireTestDatabaseUrl(), { max: 10 });
  await handle.migrate();
  repos = createRepositories(handle.db);
}, 60_000);
afterAll(async () => handle.close());
beforeEach(async () => {
  await handle.db.execute(sql`truncate analyses cascade`);
});

describe("usage quota on Postgres", () => {
  it("lets exactly as many concurrent requests through as the daily budget allows", async () => {
    const limits = parseLimits({ LIMIT_DAILY_COST_USD: "1", LIMIT_MAX_COST_USD_PER_RUN: "0.30", LIMIT_REQUESTS_PER_CLIENT_PER_DAY: "100" });
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => repos.analyses.createWithQuota(newAnalysisInput({ clientKeyHash: `client-${i}`, createdAt: now }), quotaFor(limits, now))),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(3);
    expect(results.filter((result) => !result.ok && result.reason === "daily_budget_exhausted")).toHaveLength(7);
  });

  it("lets exactly as many concurrent requests from one client through as its limit allows", async () => {
    const limits = parseLimits({ LIMIT_REQUESTS_PER_CLIENT_PER_DAY: "2", LIMIT_DAILY_COST_USD: "100" });
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => repos.analyses.createWithQuota(newAnalysisInput({ clientKeyHash: "same", createdAt: now }), quotaFor(limits, now))),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(2);
  });
});
