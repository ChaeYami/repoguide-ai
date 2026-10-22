import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parseLimits } from "../../src/config/limits.js";
import type { DbHandle } from "../../src/db/client.js";
import { createRepositories, type Repositories } from "../../src/db/repositories/index.js";
import { runAnalysis } from "../../src/pipeline/run-analysis.js";
import { newAnalysisInput } from "../support/analysis-factory.js";
import { FakeLlmClient, type FakeLlmStep } from "../support/fake-llm.js";
import { FIXTURE_SHA, fakeGithubRepo } from "../support/fake-repo.js";
import { createPgliteDb } from "../support/pglite-db.js";

// 재생성 파이프라인 (T044, FR-032, FR-033, research R15).

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

const decide = (output: Record<string, unknown> = {}) => ({
  data: { fileNotes: [], coverage: [], sufficient: false, requests: [], expandDirectories: [], ...output },
});
const ask = (...paths: string[]) => decide({ requests: paths.map((path) => ({ path, reason: `${path} 필요` })) });
const extras = { glossary: [], prerequisites: [], contextSummary: "", relatedFiles: [], promptExamples: [], checklist: [] };
const write = (purposeSection: string): FakeLlmStep => ({
  data: {
    title: "t",
    overview: "o",
    sections: [{ sectionId: purposeSection, status: "found", blocks: [{ type: "text", markdown: "근거", kind: "fact", evidence: [{ path: "package.json", startLine: 1, endLine: 2 }] }] }],
    levelExtras: extras,
    limitations: [],
  },
});

async function run(analysisId: string, github: ReturnType<typeof fakeGithubRepo>, script: { decide: FakeLlmStep[]; write: FakeLlmStep[] }) {
  const llm = new FakeLlmClient(script);
  await runAnalysis((await repos.analyses.getById(analysisId))!, new AbortController().signal, {
    repos,
    llm,
    github: () => github.github,
    models: { decide: "gemini-3.5-flash-lite", write: "gemini-3.8-flash" },
  });
  return llm;
}

async function finishedParent() {
  const parent = await repos.analyses.create(newAnalysisInput({ repoOwner: "acme", repoName: "demo", level: "beginner", purpose: "setup" }));
  await run(parent.id, fakeGithubRepo(), {
    decide: [
      decide({
        requests: [{ path: ".env.example", reason: "설정" }],
        fileNotes: [{ path: "README.md", summary: "짧은 소개뿐인 README", facts: [] }],
      }),
      decide({ sufficient: true }),
    ],
    write: [write("run_commands")],
  });
  return (await repos.analyses.getById(parent.id))!;
}

describe("change_options regeneration", () => {
  it("reuses the parent's snapshot, files and notes without calling GitHub for them", async () => {
    const parent = await finishedParent();
    expect(parent.status).toBe("completed");
    const parentManual = (await repos.manuals.getByAnalysisId(parent.id))!;
    const parentFiles = await repos.files.listExploredFiles(parent.id);

    const child = await repos.analyses.create(
      newAnalysisInput({
        repoOwner: "acme",
        repoName: "demo",
        level: "developer",
        purpose: "modify",
        snapshotId: parent.snapshotId,
        parentAnalysisId: parent.id,
        rootAnalysisId: parent.rootAnalysisId,
        regenerationMode: "change_options",
      }),
    );
    const github = fakeGithubRepo();
    const llm = await run(child.id, github, {
      decide: [ask("src/server.ts", "README.md"), decide({ sufficient: true })],
      write: [write("entry_points")],
    });

    const row = (await repos.analyses.getById(child.id))!;
    expect(row).toMatchObject({ status: "completed", snapshotId: parent.snapshotId });
    // 저장소 확인·커밋·트리 조회 없이, 새로 요청한 파일만 읽는다.
    expect(github.calls).toEqual(["file:src/server.ts"]);

    const explored = await repos.files.listExploredFiles(child.id);
    const reused = explored.filter((file) => file.source === "reused");
    expect(reused.map((file) => file.path).sort()).toEqual(parentFiles.map((file) => file.path).sort());
    expect(reused.every((file) => file.roundNo === 0 && file.reason.startsWith("이전 분석에서 재사용"))).toBe(true);
    expect(explored.find((file) => file.path === "src/server.ts")).toMatchObject({ source: "llm_request", roundNo: 1 });

    // Decide #1은 부모의 노트와 재사용 파일 목록을 받고, 재사용 원문은 다시 받지 않는다.
    expect(llm.calls[0]!.input).toContain("짧은 소개뿐인 README");
    expect(llm.calls[0]!.input).toContain("- README.md");
    expect(llm.calls[0]!.input).not.toContain('<<<FILE path="README.md"');
    const rounds = await repos.rounds.listByAnalysis(child.id);
    expect(rounds[0]!.requests.find((request) => request.path === "README.md")?.rejectReason).toBe("already_read");

    // 매뉴얼 근거로 재사용 파일을 쓸 수 있다.
    const manual = (await repos.manuals.getByAnalysisId(child.id))!;
    expect(manual.document.sections.find((section) => section.id === "entry_points")!.blocks[0]!.evidence[0]!.path).toBe("package.json");

    // 부모 분석과 매뉴얼은 그대로다.
    expect(await repos.manuals.getByAnalysisId(parent.id)).toEqual(parentManual);
    expect(await repos.files.listExploredFiles(parent.id)).toEqual(parentFiles);
    expect((await repos.analyses.getById(parent.id))!.status).toBe("completed");
  });

  it("counts reused files against the file limit", async () => {
    const parent = await finishedParent();
    const parentCount = (await repos.files.listExploredFiles(parent.id)).length;
    const child = await repos.analyses.create(
      newAnalysisInput({
        level: "developer",
        snapshotId: parent.snapshotId,
        parentAnalysisId: parent.id,
        rootAnalysisId: parent.rootAnalysisId,
        regenerationMode: "change_options",
        limits: parseLimits({ LIMIT_MAX_FILES: String(parentCount + 1) }),
      }),
    );
    await run(child.id, fakeGithubRepo(), { decide: [ask("src/server.ts", "src/db.ts"), decide({ sufficient: true })], write: [write("run_commands")] });
    const rounds = await repos.rounds.listByAnalysis(child.id);
    expect(rounds[0]!.requests.map((request) => request.rejectReason)).toEqual([null, "over_file_limit"]);
  });
});

describe("refresh_commit regeneration", () => {
  it("analyzes the newest commit from scratch on a new snapshot", async () => {
    const parent = await finishedParent();
    const newer = "f".repeat(40);
    const child = await repos.analyses.create(
      newAnalysisInput({ repoOwner: "acme", repoName: "demo", parentAnalysisId: parent.id, rootAnalysisId: parent.rootAnalysisId, regenerationMode: "refresh_commit" }),
    );
    const github = fakeGithubRepo({ commitShas: [newer] });
    await run(child.id, github, { decide: [decide({ sufficient: true })], write: [write("run_commands")] });

    const row = (await repos.analyses.getById(child.id))!;
    expect(row.status).toBe("completed");
    expect(row.snapshotId).not.toBe(parent.snapshotId);
    expect((await repos.snapshots.getById(row.snapshotId!))!.commitSha).toBe(newer);
    expect(github.calls.slice(0, 3)).toEqual(["getRepo", "getCommitSha", "getTree"]);
    expect((await repos.snapshots.getById(parent.snapshotId!))!.commitSha).toBe(FIXTURE_SHA);
  });
});
