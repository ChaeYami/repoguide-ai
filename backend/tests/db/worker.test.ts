import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPostgresDb } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { requireTestDatabaseUrl } from "./test-database.js";

// 실제 Postgres에서 동시 획득이 겹치지 않는지 확인한다(PGlite는 연결이 하나라 동시성을 검증할 수 없다).

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

describe("worker claim on Postgres", () => {
  it("hands each queued analysis to exactly one of many concurrent workers", async () => {
    const created = await Promise.all(Array.from({ length: 5 }, () => repos.analyses.create(newAnalysisInput())));
    const claims = await Promise.all(Array.from({ length: 10 }, (_, i) => repos.analyses.claimNext(`w${i}`, 60_000)));
    const claimedIds = claims.flatMap((row) => (row ? [row.id] : []));
    expect(claimedIds.sort()).toEqual(created.map((row) => row.id).sort());
  });
});
