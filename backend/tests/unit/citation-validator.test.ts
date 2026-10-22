import { describe, expect, it } from "vitest";
import { validateEvidence } from "../../src/pipeline/citation-validator.js";

const sources = new Map([
  ["src/server.ts", 30],
  ["README.md", 5],
]);

describe("validateEvidence (research R8 rules 1–2)", () => {
  it("keeps evidence inside files read in this run and within their line count", () => {
    expect(validateEvidence([{ path: "src/server.ts", startLine: 3, endLine: 10 }], sources)).toEqual({
      kept: [{ path: "src/server.ts", startLine: 3, endLine: 10 }],
      dropped: 0,
    });
  });

  it("drops evidence for files outside the working set", () => {
    expect(validateEvidence([{ path: "src/secret.ts", startLine: 1, endLine: 1 }], sources)).toEqual({ kept: [], dropped: 1 });
  });

  it.each([
    [{ startLine: 0, endLine: 2 }],
    [{ startLine: 4, endLine: 3 }],
    [{ startLine: 5, endLine: 31 }],
    [{ startLine: 1.5, endLine: 2 }],
  ])("drops out-of-range lines without repairing them: %j", (range) => {
    expect(validateEvidence([{ path: "src/server.ts", ...range }], sources)).toEqual({ kept: [], dropped: 1 });
  });

  it("normalizes paths and removes duplicates", () => {
    const result = validateEvidence(
      [
        { path: "./README.md", startLine: 1, endLine: 2 },
        { path: "README.md", startLine: 1, endLine: 2 },
      ],
      sources,
    );
    expect(result).toEqual({ kept: [{ path: "README.md", startLine: 1, endLine: 2 }], dropped: 0 });
  });
});
