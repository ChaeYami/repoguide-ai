import { describe, expect, it } from "vitest";
import {
  AnalysisDetailSchema,
  CreateAnalysisRequestSchema,
  ErrorResponseSchema,
  LevelSchema,
  ManualSchema,
  RegenerationRequestSchema,
  SECTION_CATALOG,
  sectionIdsFor,
  type Manual,
} from "../src/index.js";

const SHA = "a".repeat(40);
const NOW = "2026-10-22T03:00:00.000Z";

function manualFor(overrides: Partial<Manual> = {}): Manual {
  return {
    analysisId: crypto.randomUUID(),
    language: "ko",
    level: "developer",
    purpose: "understand",
    repo: { owner: "acme", name: "app", ref: "main", commitSha: SHA, htmlUrl: "https://github.com/acme/app" },
    title: "acme/app 매뉴얼",
    overview: "요약",
    sections: sectionIdsFor("understand").map((id) => ({
      id,
      title: "제목",
      status: "not_found" as const,
      blocks: [],
    })),
    levelExtras: { level: "developer" },
    limitations: [],
    generatedAt: NOW,
    model: "gemini-3.8-flash",
    promptVersion: "1",
    ...overrides,
  };
}

describe("section catalog", () => {
  it("matches the order defined in contracts/manual.md", () => {
    expect(sectionIdsFor("understand")).toEqual([
      "role",
      "core_features",
      "components",
      "architecture",
      "execution_flow",
    ]);
    expect(sectionIdsFor("setup")).toEqual([
      "environment",
      "dependencies",
      "install_steps",
      "configuration",
      "run_commands",
      "verification",
    ]);
    expect(sectionIdsFor("modify")).toEqual([
      "entry_points",
      "related_files",
      "data_flow",
      "change_points",
      "extension_directions",
      "change_verification",
    ]);
  });

  it("gives every section a Korean title and writing guidance", () => {
    for (const sections of Object.values(SECTION_CATALOG)) {
      for (const section of sections) {
        expect(section.title).toMatch(/[가-힣]/);
        expect(section.guidance.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("Manual schema", () => {
  it("accepts a manual that follows the catalog", () => {
    expect(ManualSchema.safeParse(manualFor()).success).toBe(true);
  });

  it("rejects sections out of catalog order", () => {
    const manual = manualFor();
    manual.sections.reverse();
    expect(ManualSchema.safeParse(manual).success).toBe(false);
  });

  it("rejects level extras for a different level", () => {
    const manual = manualFor({ level: "beginner" });
    expect(ManualSchema.safeParse(manual).success).toBe(false);
  });

  it("rejects a fact block without evidence", () => {
    const manual = manualFor();
    manual.sections[0] = {
      ...manual.sections[0]!,
      status: "found",
      blocks: [{ id: "role.1", type: "text", markdown: "설명", kind: "fact", downgraded: false, evidence: [] }],
    };
    expect(ManualSchema.safeParse(manual).success).toBe(false);
  });

  it("rejects evidence whose end line precedes the start line", () => {
    const manual = manualFor();
    manual.sections[0] = {
      ...manual.sections[0]!,
      status: "found",
      blocks: [
        {
          id: "role.1",
          type: "text",
          markdown: "설명",
          kind: "fact",
          downgraded: false,
          evidence: [{ path: "README.md", startLine: 10, endLine: 2, url: "https://github.com/acme/app" }],
        },
      ],
    };
    expect(ManualSchema.safeParse(manual).success).toBe(false);
  });
});

describe("API schemas", () => {
  it("rejects unknown levels", () => {
    expect(LevelSchema.safeParse("expert").success).toBe(false);
    expect(
      CreateAnalysisRequestSchema.safeParse({ repoUrl: "https://github.com/a/b", level: "expert", purpose: "setup" })
        .success,
    ).toBe(false);
  });

  it("accepts the documented create request", () => {
    expect(
      CreateAnalysisRequestSchema.safeParse({
        repoUrl: "https://github.com/a/b",
        level: "beginner",
        purpose: "setup",
      }).success,
    ).toBe(true);
  });

  it("discriminates regeneration modes", () => {
    expect(RegenerationRequestSchema.safeParse({ mode: "refresh_commit" }).success).toBe(true);
    expect(RegenerationRequestSchema.safeParse({ mode: "change_options", level: "developer" }).success).toBe(true);
    expect(RegenerationRequestSchema.safeParse({ mode: "rewrite" }).success).toBe(false);
  });

  it("accepts an error response with retry information", () => {
    expect(
      ErrorResponseSchema.safeParse({
        error: { code: "rate_limited", message: "오늘 요청 한도에 도달했습니다", retryAfterSec: 3600 },
      }).success,
    ).toBe(true);
  });

  it("accepts a queued analysis detail with a queue position", () => {
    const id = crypto.randomUUID();
    const detail = {
      id,
      repo: { owner: "acme", name: "app", ref: null, commitSha: null, subpath: null, htmlUrl: "https://github.com/acme/app" },
      level: "beginner",
      purpose: "setup",
      status: "queued",
      createdAt: NOW,
      finishedAt: null,
      stage: "queued",
      progress: { round: 0, maxRounds: 3, filesRead: 0, filesPlanned: 0, activity: null, updatedAt: NOW },
      queuePosition: 2,
      failure: null,
      partialReasons: [],
      hasManual: false,
      expiresAt: NOW,
      parentId: null,
      regenerationMode: null,
      versions: [],
    };
    expect(AnalysisDetailSchema.safeParse(detail).success).toBe(true);
  });
});
