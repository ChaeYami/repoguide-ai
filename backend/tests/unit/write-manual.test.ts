import { describe, expect, it } from "vitest";
import { parseLimits } from "../../src/config/limits.js";
import type { WriteOutput } from "../../src/llm/schemas.js";
import { BudgetGuard } from "../../src/pipeline/budget.js";
import type { WorkingFile } from "../../src/pipeline/explore-loop.js";
import { LEVEL_GUIDES } from "../../src/llm/prompts/level-guides.js";
import { ProgressReporter } from "../../src/pipeline/progress.js";
import {
  prioritize,
  selectWithinContentLimit,
  writeManual,
  WriteLimitError,
  ManualGenerationError,
  type WriteInput,
} from "../../src/pipeline/write-manual.js";
import { FakeLlmClient } from "../support/fake-llm.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

const file = (path: string, source: WorkingFile["source"], roundNo: number, content = "line1\nline2\n"): WorkingFile => ({
  path, sizeBytes: content.length, content, lineCount: content.split("\n").length - 1, truncated: false,
  skippedReason: null, snapshotFileId: `id-${path}`, source, roundNo, reason: "test",
});

const workingSet = [
  file("src/early.ts", "llm_request", 1),
  file("README.md", "seed", 1),
  file("src/late.ts", "llm_request", 3),
  file("src/noted.ts", "llm_request", 1),
  file("old/reused.ts", "reused", 0),
  { ...file("logo.bin", "llm_request", 2), content: null, lineCount: 0, skippedReason: "binary" as const },
];
const notes = [{ path: "src/noted.ts", summary: "요약", facts: [{ text: "사실", startLine: 1, endLine: 1 }] }];

const writeOutput: WriteOutput = {
  title: "설치 매뉴얼",
  overview: "요약",
  sections: [
    {
      sectionId: "install_steps",
      status: "found",
      blocks: [{ type: "step", stepNo: 1, markdown: "의존성을 설치합니다.", kind: "fact", command: "npm install", expectedResult: "완료", troubleshooting: "Node 확인", evidence: [{ path: "README.md", startLine: 1, endLine: 2 }] }],
    },
  ],
  levelExtras: { glossary: [{ term: "npm", explanation: "패키지 관리자" }], prerequisites: [], contextSummary: "", relatedFiles: [], promptExamples: [], checklist: [] },
  limitations: [],
};

function setup(limits: Record<string, string> = {}, write: ConstructorParameters<typeof FakeLlmClient>[0]["write"] = [{ data: writeOutput }]) {
  const budget = new BudgetGuard(parseLimits(limits), () => ({ inputPerMTok: 0.75, outputPerMTok: 3.75 }));
  const llm = new FakeLlmClient({ write });
  const progress = new ProgressReporter({ updateProgress: async () => {} }, "a1", { round: 0, maxRounds: 3, filesRead: 0, filesPlanned: 0, activity: null, updatedAt: new Date().toISOString() });
  const input: WriteInput = {
    analysisId: "11111111-1111-4111-8111-111111111111",
    repo: { owner: "acme", name: "demo", description: null, language: "TypeScript", ref: "main", commitSha: SHA, subpath: null, htmlUrl: "https://github.com/acme/demo" },
    stack: { languages: ["TypeScript"], packageManagers: ["npm"], frameworkHints: [], manifests: [] },
    level: "beginner",
    purpose: "setup",
    workingSet,
    notes,
    coverage: [],
    codeLimitations: [],
  };
  return { budget, llm, deps: { llm, budget, progress, writeModel: "gemini-3.8-flash" }, input };
}

describe("prioritize / selectWithinContentLimit", () => {
  it("orders seeds, files with facts, later rounds, then the rest", () => {
    expect(prioritize(workingSet.filter((f) => f.content), notes).map((f) => f.path)).toEqual([
      "README.md", "src/noted.ts", "src/late.ts", "src/early.ts", "old/reused.ts",
    ]);
  });

  it("skips files that would exceed the content limit", () => {
    const ordered = [file("a", "seed", 1, "x".repeat(60)), file("b", "llm_request", 1, "y".repeat(50)), file("c", "llm_request", 1, "z".repeat(30))];
    expect(selectWithinContentLimit(ordered, 100).map((f) => f.path)).toEqual(["a", "c"]);
  });
});

describe("writeManual", () => {
  it("sends the level guide and all readable content when the budget allows", async () => {
    const { llm, deps, input, budget } = setup();
    const result = await writeManual(input, deps);
    expect(result.contentTrimmed).toBe(false);
    expect(result.includedPaths.sort()).toEqual(["README.md", "old/reused.ts", "src/early.ts", "src/late.ts", "src/noted.ts"]);
    expect(llm.calls[0]!.systemInstruction).toContain(LEVEL_GUIDES.beginner);
    expect(llm.calls[0]!.input).toContain('<<<FILE path="README.md"');
    expect(result.manual.sections.find((s) => s.id === "install_steps")!.blocks[0]!.evidence[0]!.url).toContain(`/blob/${SHA}/README.md#L1-L2`);
    expect(budget.snapshot().costUsd).toBeGreaterThan(0);
    expect(result.usage.costUsd).toBe(budget.snapshot().costUsd);
  });

  it("uses a different guide for a different level", async () => {
    const { llm, deps, input } = setup({}, [{ data: { ...writeOutput, levelExtras: { ...writeOutput.levelExtras, glossary: [] } } }]);
    await writeManual({ ...input, level: "developer" }, deps);
    expect(llm.calls[0]!.systemInstruction).toContain(LEVEL_GUIDES.developer);
    expect(llm.calls[0]!.systemInstruction).not.toContain(LEVEL_GUIDES.beginner);
  });

  it("drops low-priority raw content first under a tight cost cap and marks content_trimmed", async () => {
    // 파일당 3만 자(≈1만 토큰, ≈$0.0075). 프롬프트 기본 ≈$0.07에 파일 2~4개만 들어가는 상한.
    const big = (path: string, source: WorkingFile["source"], roundNo: number) =>
      file(path, source, roundNo, `${"x".repeat(99)}\n`.repeat(300));
    const { llm, deps, input } = setup({ LIMIT_MAX_COST_USD_PER_RUN: "0.095" });
    const result = await writeManual(
      { ...input, workingSet: [big("src/early.ts", "llm_request", 1), big("README.md", "seed", 1), big("src/late.ts", "llm_request", 3), big("src/noted.ts", "llm_request", 1), big("old/reused.ts", "reused", 0)] },
      deps,
    );
    expect(result.contentTrimmed).toBe(true);
    expect(result.includedPaths[0]).toBe("README.md");
    expect(result.includedPaths.length).toBeGreaterThanOrEqual(2);
    expect(result.includedPaths.length).toBeLessThan(5);
    expect(result.includedPaths).not.toContain("old/reused.ts");
    expect(result.manual.limitations).toContain("분석량 한도 때문에 일부 파일은 원문 대신 요약만 반영했습니다.");
    expect(llm.calls[0]!.maxOutputTokens).toBe(16_000);
  });

  it("then lowers the output cap, and fails with WriteLimitError when nothing fits", async () => {
    // 출력 16k로는 넘치고 8k(≈$0.04)면 들어오는 상한
    const reduced = setup({ LIMIT_MAX_COST_USD_PER_RUN: "0.045" });
    await writeManual(reduced.input, reduced.deps);
    expect(reduced.llm.calls[0]!.maxOutputTokens).toBeLessThan(16_000);

    const impossible = setup({ LIMIT_MAX_COST_USD_PER_RUN: "0.001" });
    await expect(writeManual(impossible.input, impossible.deps)).rejects.toBeInstanceOf(WriteLimitError);
    expect(impossible.llm.calls).toHaveLength(0);
  });

  it("turns a persistent schema failure into ManualGenerationError and still counts its cost", async () => {
    const { deps, input, budget } = setup({}, [{ data: { wrong: true } }]);
    await expect(writeManual(input, deps)).rejects.toBeInstanceOf(ManualGenerationError);
    expect(budget.snapshot().inputTokens).toBeGreaterThan(0);
  });
});
