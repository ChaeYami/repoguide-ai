import { ManualSchema, sectionIdsFor } from "@repoguide/shared";
import { describe, expect, it } from "vitest";
import type { WriteOutput } from "../../src/llm/schemas.js";
import { assembleManual, README_ONLY_LIMITATION, type AssembleInput } from "../../src/pipeline/manual-assembler.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const emptyExtras: WriteOutput["levelExtras"] = { glossary: [], prerequisites: [], contextSummary: "", relatedFiles: [], promptExamples: [], checklist: [] };

function input(output: Partial<WriteOutput>, overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    output: { title: "Demo 설치 매뉴얼", overview: "요약", sections: [], levelExtras: emptyExtras, limitations: [], ...output },
    analysisId: "11111111-1111-4111-8111-111111111111",
    level: "beginner",
    purpose: "setup",
    repo: { owner: "acme", name: "demo", ref: "main", commitSha: SHA, htmlUrl: "https://github.com/acme/demo" },
    sources: new Map([
      ["README.md", 3],
      ["package.json", 12],
      ["src/server.ts", 3],
    ]),
    codeLimitations: [],
    model: "gemini-3.8-flash",
    promptVersion: "test",
    generatedAt: new Date("2026-10-22T03:00:00Z"),
    ...overrides,
  };
}

const block = (overrides: Partial<WriteOutput["sections"][number]["blocks"][number]>) => ({
  type: "text" as const,
  markdown: "설명",
  kind: "fact" as const,
  evidence: [{ path: "package.json", startLine: 2, endLine: 4 }],
  ...overrides,
});

describe("assembleManual — contracts/manual.md invariants", () => {
  it("1. includes every catalog section in catalog order with code-defined titles", () => {
    const { manual, stats } = assembleManual(
      input({
        sections: [
          { sectionId: "run_commands", status: "found", blocks: [block({})] },
          { sectionId: "environment", status: "found", blocks: [block({})] },
        ],
      }),
    );
    expect(manual.sections.map((s) => s.id)).toEqual(sectionIdsFor("setup"));
    expect(manual.sections[0]!.title).toBe("실행 환경");
    expect(manual.sections.map((s) => s.status)).toEqual(["found", "not_found", "not_found", "not_found", "found", "not_found"]);
    expect(stats.sectionsNotFound).toBe(4);
  });

  it("2–3. keeps only valid evidence and links it to the commit-pinned line range", () => {
    const { manual, stats } = assembleManual(
      input({
        sections: [
          {
            sectionId: "dependencies",
            status: "found",
            blocks: [
              block({
                evidence: [
                  { path: "package.json", startLine: 2, endLine: 4 },
                  { path: "src/missing.ts", startLine: 1, endLine: 1 },
                  { path: "package.json", startLine: 10, endLine: 99 },
                ],
              }),
            ],
          },
        ],
      }),
    );
    const evidence = manual.sections[1]!.blocks[0]!.evidence;
    expect(evidence).toEqual([
      { path: "package.json", startLine: 2, endLine: 4, url: `https://github.com/acme/demo/blob/${SHA}/package.json#L2-L4` },
    ]);
    expect(stats).toMatchObject({ evidenceKept: 1, evidenceDropped: 2 });
  });

  it("4. downgrades a fact whose evidence was all invalid to an inference", () => {
    const { manual, stats } = assembleManual(
      input({ sections: [{ sectionId: "environment", status: "found", blocks: [block({ evidence: [{ path: "nope.ts", startLine: 1, endLine: 1 }] })] }] }),
    );
    expect(manual.sections[0]!.blocks[0]).toMatchObject({ kind: "inference", downgraded: true, evidence: [] });
    expect(stats).toMatchObject({ downgraded: 1, facts: 0, inferences: 1 });
  });

  it("5. keeps only the extras of the requested level", () => {
    const extras = { ...emptyExtras, glossary: [{ term: "npm", explanation: "패키지 관리자" }], contextSummary: "맥락", checklist: ["실행 확인"] };
    expect(assembleManual(input({ levelExtras: extras })).manual.levelExtras).toEqual({
      level: "beginner",
      glossary: [{ term: "npm", explanation: "패키지 관리자" }],
      prerequisites: [],
    });
    expect(assembleManual(input({ levelExtras: extras }, { level: "developer" })).manual.levelExtras).toEqual({ level: "developer" });
  });

  it("5. keeps only working-set paths in vibe-coder related files and links them", () => {
    const extras = {
      ...emptyExtras,
      relatedFiles: [
        { path: "./src/server.ts", why: "서버 진입점" },
        { path: "src/invented.ts", why: "없는 파일" },
      ],
    };
    const { manual } = assembleManual(input({ levelExtras: extras }, { level: "vibe_coder" }));
    expect(manual.levelExtras).toMatchObject({
      level: "vibe_coder",
      relatedFiles: [{ path: "src/server.ts", why: "서버 진입점", url: `https://github.com/acme/demo/blob/${SHA}/src/server.ts` }],
    });
  });

  it("6. counts beginner steps missing an expected result or troubleshooting tip", () => {
    const { stats } = assembleManual(
      input({
        sections: [
          {
            sectionId: "install_steps",
            status: "found",
            blocks: [
              block({ type: "step", stepNo: 1, command: "npm install", expectedResult: "added 100 packages", troubleshooting: "Node 버전 확인" }),
              block({ type: "step", stepNo: 2, command: "npm run dev" }),
            ],
          },
        ],
      }),
    );
    expect(stats.stepWarnings).toBe(1);
  });

  it("puts code limitations before LLM limitations and dedupes them", () => {
    const { manual } = assembleManual(
      input({ limitations: ["테스트 폴더는 읽지 않았습니다.", "탐색 한도에 도달했습니다."] }, { codeLimitations: ["탐색 한도에 도달했습니다."] }),
    );
    expect(manual.limitations).toEqual(["탐색 한도에 도달했습니다.", "테스트 폴더는 읽지 않았습니다."]);
  });

  it("adds the fixed README-only limitation first when nothing but README was readable (FR-008)", () => {
    const { manual } = assembleManual(input({}, { sources: new Map([["README.md", 3]]), codeLimitations: ["코드 한계"] }));
    expect(manual.limitations).toEqual([README_ONLY_LIMITATION, "코드 한계"]);
  });

  it("turns a section the model marked not_found but filled with blocks into partial, and drops empty blocks", () => {
    const { manual } = assembleManual(
      input({
        sections: [{ sectionId: "verification", status: "not_found", blocks: [block({ kind: "inference", evidence: [] }), block({ markdown: "  " })] }],
      }),
    );
    const verification = manual.sections.find((s) => s.id === "verification")!;
    expect(verification.status).toBe("partial");
    expect(verification.blocks).toHaveLength(1);
  });

  it("always produces a document that passes the shared Manual schema", () => {
    const { manual } = assembleManual(input({ title: "  ", sections: [{ sectionId: "environment", status: "found", blocks: [block({})] }] }));
    expect(manual.title).toBe("acme/demo 매뉴얼");
    expect(ManualSchema.safeParse(manual).success).toBe(true);
  });
});
