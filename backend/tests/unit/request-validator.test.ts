import { sectionIdsFor } from "@repoguide/shared";
import { describe, expect, it } from "vitest";
import type { Candidate } from "../../src/db/json-types.js";
import type { DecideOutput } from "../../src/llm/schemas.js";
import { normalizePath, validateDecideOutput, type RequestValidationInput } from "../../src/pipeline/request-validator.js";

const candidate = (path: string): Candidate => ({ path, size: 100, blobSha: `sha-${path}` });

function input(output: Partial<DecideOutput>, overrides: Partial<RequestValidationInput> = {}): RequestValidationInput {
  return {
    output: { fileNotes: [], coverage: [], sufficient: false, requests: [], expandDirectories: [], ...output },
    candidates: new Map(["src/a.ts", "src/b.ts", "src/c.ts", "README.md", "docs/x.md"].map((p) => [p, candidate(p)])),
    excluded: new Map([
      ["package-lock.json", "lockfile"],
      ["data/huge.json", "too_large"],
    ]),
    directories: new Set(["src", "docs", "data"]),
    alreadyRead: new Set(["README.md"]),
    maxPerRound: 15,
    remainingFiles: 40,
    remainingGithubCalls: 80,
    sectionIds: sectionIdsFor("setup"),
    newFiles: new Map(),
    ...overrides,
  };
}

const req = (path: string) => ({ path, reason: `need ${path}` });

describe("normalizePath", () => {
  it.each([
    ["./src/a.ts", "src/a.ts"],
    ["/src/a.ts", "src/a.ts"],
    ["src//a.ts", "src/a.ts"],
    ["src\\a.ts", "src/a.ts"],
    ["  src/a.ts ", "src/a.ts"],
  ])("%j → %s", (raw, normalized) => expect(normalizePath(raw)).toBe(normalized));
});

describe("validateDecideOutput — requests", () => {
  it("records every rejection reason in the documented order", () => {
    const result = validateDecideOutput(
      input({
        requests: [
          req("src/missing.ts"),
          req("src/"),
          req("package-lock.json"),
          req("data/huge.json"),
          req("README.md"),
          req("./src/a.ts"),
          req("src/a.ts"),
        ],
      }),
    );
    expect(result.records.map((r) => [r.path, r.accepted, r.rejectReason])).toEqual([
      ["src/missing.ts", false, "not_in_tree"],
      ["src/", false, "not_a_file"],
      ["package-lock.json", false, "excluded"],
      ["data/huge.json", false, "too_large"],
      ["README.md", false, "already_read"],
      ["src/a.ts", true, null],
      ["src/a.ts", false, "already_read"],
    ]);
    expect(result.accepted.map((a) => [a.candidate.path, a.reason])).toEqual([["src/a.ts", "need ./src/a.ts"]]);
  });

  it("caps accepted files by round, file and GitHub-call budgets", () => {
    const requests = [req("src/a.ts"), req("src/b.ts"), req("src/c.ts"), req("docs/x.md")];
    expect(validateDecideOutput(input({ requests }, { maxPerRound: 2 })).records.map((r) => r.rejectReason)).toEqual([
      null, null, "over_round_limit", "over_round_limit",
    ]);
    expect(validateDecideOutput(input({ requests }, { remainingFiles: 1 })).records.map((r) => r.rejectReason)).toEqual([
      null, "over_file_limit", "over_file_limit", "over_file_limit",
    ]);
    expect(validateDecideOutput(input({ requests }, { remainingGithubCalls: 3 })).records.map((r) => r.rejectReason)).toEqual([
      null, null, null, "budget",
    ]);
  });

  it("never accepts more than the round limit even when an injected file asks for everything", () => {
    const requests = Array.from({ length: 100 }, (_, i) => req(i % 2 ? "src/a.ts" : `src/f${i}.ts`));
    const candidates = new Map(Array.from({ length: 100 }, (_, i) => [`src/f${i}.ts`, candidate(`src/f${i}.ts`)] as const));
    const result = validateDecideOutput(input({ requests }, { candidates, maxPerRound: 15 }));
    expect(result.accepted).toHaveLength(15);
  });
});

describe("validateDecideOutput — expansions, coverage and notes", () => {
  it("keeps at most 5 existing directories to expand", () => {
    const directories = new Set(["a", "b", "c", "d", "e", "f"]);
    const result = validateDecideOutput(
      input({ expandDirectories: ["a/", "./b", "nope", "c", "d", "e", "f", "a"] }, { directories }),
    );
    expect(result.expandDirectories).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("fills missing catalog sections with 'missing' in catalog order", () => {
    const result = validateDecideOutput(
      input({ coverage: [{ sectionId: "run_commands", status: "covered", note: "package.json scripts" }] }),
    );
    expect(result.coverage.map((c) => [c.sectionId, c.status])).toEqual([
      ["environment", "missing"],
      ["dependencies", "missing"],
      ["install_steps", "missing"],
      ["configuration", "missing"],
      ["run_commands", "covered"],
      ["verification", "missing"],
    ]);
  });

  it("keeps notes only for files given this round and drops facts with invalid line ranges", () => {
    const result = validateDecideOutput(
      input(
        {
          fileNotes: [
            {
              path: "./src/a.ts",
              summary: "x".repeat(500),
              facts: [
                { text: "valid", startLine: 1, endLine: 10 },
                { text: "past end", startLine: 5, endLine: 11 },
                { text: "reversed", startLine: 4, endLine: 2 },
                { text: "zero", startLine: 0, endLine: 1 },
              ],
            },
            { path: "src/b.ts", summary: "not provided this round", facts: [] },
          ],
        },
        { newFiles: new Map([["src/a.ts", 10]]) },
      ),
    );
    expect(result.fileNotes).toEqual([
      { path: "src/a.ts", summary: "x".repeat(400), facts: [{ text: "valid", startLine: 1, endLine: 10 }] },
    ]);
  });
});
