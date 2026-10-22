import { BatchSummaryResponseSchema } from "@repoguide/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerAnalysesRoutes } from "../../src/api/routes/analyses.js";
import { buildServer } from "../../src/api/server.js";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { createPgliteDb } from "../support/pglite-db.js";

// 최근 목록 일괄 조회 (T038, FR-030, research R14)

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

async function get(query: string) {
  const app = await buildServer({
    db: handle,
    logger: false,
    routes: (instance) => registerAnalysesRoutes(instance, { repos, limits: parseLimits({}), retentionDays: 30, clientKeySalt: "s".repeat(40) }),
  });
  return app.inject({ method: "GET", url: `/api/analyses${query}` });
}

const UNKNOWN = "33333333-3333-4333-8333-333333333333";
const manyIds = Array.from({ length: 21 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`).join(",");

describe("GET /api/analyses?ids=", () => {
  it("returns summaries in request order and lists expired or unknown ids as missing", async () => {
    const a = await repos.analyses.create(newAnalysisInput({ repoName: "a" }));
    const b = await repos.analyses.create(newAnalysisInput({ repoName: "b" }));
    const gone = await repos.analyses.create(newAnalysisInput({ repoName: "gone" }));
    await handle.db.execute(sql`update analyses set status = 'expired' where id = ${gone.id}`);

    const res = await get(`?ids=${b.id},${UNKNOWN},${a.id},${gone.id}`);
    expect(res.statusCode).toBe(200);
    const body = BatchSummaryResponseSchema.parse(res.json());
    expect(body.items.map((item) => item.repo.name)).toEqual(["b", "a"]);
    expect(body.items[0]).toMatchObject({ status: "queued", level: "beginner", purpose: "setup" });
    expect(body.missingIds).toEqual([UNKNOWN, gone.id]);
  });

  it.each([
    ["missing ids", ""],
    ["empty ids", "?ids="],
    ["not a uuid", "?ids=abc"],
    ["more than 20", `?ids=${manyIds}`],
  ])("rejects %s with 400", async (_name, query) => {
    const res = await get(query);
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("invalid_request");
  });
});
