import { AnalysisDetailSchema } from "@repoguide/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FAILURE_MESSAGES } from "../../src/api/messages.js";
import { registerAnalysesRoutes } from "../../src/api/routes/analyses.js";
import { buildServer } from "../../src/api/server.js";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { EMPTY_USAGE } from "../../src/db/repositories/analyses.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { runAnalysis } from "../../src/pipeline/run-analysis.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { FakeLlmClient } from "../support/fake-llm.js";
import { fakeGithubRepo } from "../support/fake-repo.js";
import { createPgliteDb } from "../support/pglite-db.js";

// 실패 응답 안전성 (T033, FR-028, FR-029, SC-007): 내부 오류 상세는 서버 로그에만 남기고, 응답은 고정 문구와 재시도 시각만 담는다.

const NOW = new Date("2026-10-22T03:00:00Z");
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

async function detail(id: string) {
  const app = await buildServer({
    db: handle,
    logger: false,
    routes: (instance) =>
      registerAnalysesRoutes(instance, { repos, limits: parseLimits({}), retentionDays: 30, clientKeySalt: "s".repeat(40), now: () => NOW }),
  });
  const res = await app.inject({ method: "GET", url: `/api/analyses/${id}` });
  return { body: res.body, detail: AnalysisDetailSchema.parse(res.json()) };
}

describe("failure responses", () => {
  it("never expose internal exception messages, stacks or upstream responses", async () => {
    const secret = "db password=hunter2 at /srv/app/internal.ts:42 upstream={\"token\":\"ghp_x\"}";
    const github = fakeGithubRepo();
    github.github.getTree = async () => {
      throw new Error(secret);
    };
    const analysis = await repos.analyses.create(newAnalysisInput());
    const logged: unknown[] = [];
    await runAnalysis(analysis, new AbortController().signal, {
      repos,
      llm: new FakeLlmClient({}),
      github: () => github.github,
      models: { decide: "gemini-3.5-flash-lite", write: "gemini-3.8-flash" },
      logger: { info() {}, warn() {}, error: (obj) => void logged.push(obj) },
    });

    const { body, detail: result } = await detail(analysis.id);
    expect(result.failure).toEqual({ code: "internal_error", ...FAILURE_MESSAGES.internal_error, retryAfterSec: null });
    for (const leak of ["hunter2", "internal.ts", "ghp_x", "stack", "Error:"]) expect(body).not.toContain(leak);
    // 상세는 서버 로그로만 간다.
    expect(JSON.stringify(logged, (_k, v) => (v instanceof Error ? v.message : v))).toContain("hunter2");
  });

  it("computes retryAfterSec from the stored retry time for rate-limit failures", async () => {
    const analysis = await repos.analyses.create(newAnalysisInput());
    await repos.analyses.finish(analysis.id, {
      status: "failed",
      failureCode: "github_rate_limited",
      failureRetryAt: new Date(NOW.getTime() + 125_500),
      usage: EMPTY_USAGE,
    });
    expect((await detail(analysis.id)).detail.failure).toMatchObject({ code: "github_rate_limited", retryAfterSec: 126 });
  });

  it("reports 0 seconds once the retry time has passed and null for other failures", async () => {
    const passed = await repos.analyses.create(newAnalysisInput());
    await repos.analyses.finish(passed.id, { status: "failed", failureCode: "llm_rate_limited", failureRetryAt: new Date(NOW.getTime() - 5_000), usage: EMPTY_USAGE });
    expect((await detail(passed.id)).detail.failure?.retryAfterSec).toBe(0);

    const other = await repos.analyses.create(newAnalysisInput());
    await repos.analyses.finish(other.id, { status: "failed", failureCode: "repo_empty", usage: EMPTY_USAGE });
    expect((await detail(other.id)).detail.failure?.retryAfterSec).toBeNull();
  });
});
