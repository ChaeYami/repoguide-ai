import { TraceResponseSchema } from "@repoguide/shared";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerAnalysesRoutes } from "../../src/api/routes/analyses.js";
import { buildServer } from "../../src/api/server.js";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { runAnalysis } from "../../src/pipeline/run-analysis.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { FakeLlmClient } from "../support/fake-llm.js";
import { FIXTURE_FILES, FIXTURE_SHA, fakeGithubRepo } from "../support/fake-repo.js";
import { createPgliteDb } from "../support/pglite-db.js";

// 근거 연결 끝단 검증 (T032, FR-024~FR-027, SC-003, Constitution V):
// LLM이 잘못된 근거를 섞어 보내도 저장·노출되는 매뉴얼의 모든 "확인됨" 블록은 실제로 읽은 파일의 실제 범위를 가리킨다.

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

const lineCount = (path: string) => FIXTURE_FILES[path]!.split("\n").length - 1;
const text = (markdown: string, evidence: { path: string; startLine: number; endLine: number }[], kind: "fact" | "inference" = "fact") => ({
  type: "text" as const,
  markdown,
  kind,
  evidence,
});

const mixedWrite = {
  title: "Demo 매뉴얼",
  overview: "요약",
  sections: [
    { sectionId: "environment", status: "found", blocks: [text("유효한 근거", [{ path: "Dockerfile", startLine: 1, endLine: 1 }])] },
    {
      sectionId: "dependencies",
      status: "found",
      blocks: [
        text("하나는 유효, 둘은 무효", [
          { path: "package.json", startLine: 1, endLine: lineCount("package.json") },
          { path: "src/invented.ts", startLine: 1, endLine: 3 },
          { path: "package.json", startLine: 2, endLine: 999 },
        ]),
      ],
    },
    { sectionId: "install_steps", status: "found", blocks: [text("존재하지 않는 파일만 인용", [{ path: "INSTALL.md", startLine: 1, endLine: 4 }])] },
    { sectionId: "configuration", status: "found", blocks: [text("범위를 넘은 라인만 인용", [{ path: ".env.example", startLine: 2, endLine: 40 }])] },
    { sectionId: "run_commands", status: "found", blocks: [text("근거 없는 사실", [])] },
    { sectionId: "verification", status: "partial", blocks: [text("원래 추론", [], "inference")] },
  ],
  levelExtras: { glossary: [], prerequisites: [], contextSummary: "", relatedFiles: [], promptExamples: [], checklist: [] },
  limitations: [],
};

describe("citations end to end", () => {
  it("keeps only real evidence, downgrades the rest and exposes consistent links in the manual and trace", async () => {
    const analysis = await repos.analyses.create(newAnalysisInput({ repoOwner: "acme", repoName: "demo" }));
    await runAnalysis(analysis, new AbortController().signal, {
      repos,
      llm: new FakeLlmClient({
        decide: [
          { data: { fileNotes: [], coverage: [], sufficient: false, requests: [{ path: "src/server.ts", reason: "진입점" }], expandDirectories: [] } },
          { data: { fileNotes: [], coverage: [], sufficient: true, requests: [], expandDirectories: [] } },
        ],
        write: [{ data: mixedWrite }],
      }),
      github: () => fakeGithubRepo().github,
      models: { decide: "gemini-3.5-flash-lite", write: "gemini-3.8-flash" },
    });

    const stored = (await repos.manuals.getByAnalysisId(analysis.id))!;
    const blocks = stored.document.sections.flatMap((section) => section.blocks);

    // 모든 확인됨 블록은 유효한 근거를 1개 이상 가진다.
    const facts = blocks.filter((block) => block.kind === "fact");
    expect(facts.map((block) => block.markdown)).toEqual(["유효한 근거", "하나는 유효, 둘은 무효"]);
    for (const block of facts) expect(block.evidence.length).toBeGreaterThan(0);

    // 근거를 잃은 사실 3개는 추론으로 강등되고 기록된다. 원래 추론은 강등이 아니다.
    const downgraded = blocks.filter((block) => block.downgraded).map((block) => block.markdown);
    expect(downgraded).toEqual(["존재하지 않는 파일만 인용", "범위를 넘은 라인만 인용", "근거 없는 사실"]);
    expect(blocks.find((block) => block.markdown === "원래 추론")).toMatchObject({ kind: "inference", downgraded: false });
    expect(stored.stats).toMatchObject({ facts: 2, inferences: 4, downgraded: 3, evidenceKept: 2, evidenceDropped: 4 });

    // 남은 근거는 범위가 줄 수 안에 있고, 분석 커밋으로 고정된 링크를 가진다.
    const evidence = facts.flatMap((block) => block.evidence);
    for (const item of evidence) {
      expect(item.startLine).toBeGreaterThanOrEqual(1);
      expect(item.endLine).toBeLessThanOrEqual(lineCount(item.path));
      expect(item.url).toBe(
        `https://github.com/Acme/Demo/blob/${FIXTURE_SHA}/${item.path}#L${item.startLine}${item.startLine === item.endLine ? "" : `-L${item.endLine}`}`,
      );
    }

    // /trace의 파일 목록이 모든 근거 경로를 포함한다.
    const app = await buildServer({
      db: handle,
      logger: false,
      routes: (instance) => registerAnalysesRoutes(instance, { repos, limits: parseLimits({}), retentionDays: 30, clientKeySalt: "s".repeat(40) }),
    });
    const trace = TraceResponseSchema.parse((await app.inject({ method: "GET", url: `/api/analyses/${analysis.id}/trace` })).json());
    const tracedPaths = new Set(trace.files.map((file) => file.path));
    for (const item of evidence) expect(tracedPaths.has(item.path)).toBe(true);
    for (const file of trace.files) expect(file.githubUrl).toContain(`/blob/${FIXTURE_SHA}/`);
  });
});
