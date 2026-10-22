import { z } from "zod";
import { LevelSchema, PurposeSchema } from "./enums.js";
import { SectionIdSchema, sectionIdsFor } from "./sections.js";

// contracts/manual.md의 Manual 문서 구조. 조립이 끝난 매뉴얼은 이 스키마를 통과해야 한다.

export const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/;

export const EvidenceSchema = z
  .object({
    path: z.string().min(1),
    startLine: z.number().int().min(1),
    endLine: z.number().int().min(1),
    url: z.url(),
  })
  .refine((evidence) => evidence.endLine >= evidence.startLine, {
    message: "endLine은 startLine보다 작을 수 없습니다",
  });
export type Evidence = z.infer<typeof EvidenceSchema>;

export const ManualBlockSchema = z
  .object({
    id: z.string().min(1),
    type: z.enum(["text", "step"]),
    markdown: z.string(),
    kind: z.enum(["fact", "inference"]),
    downgraded: z.boolean(),
    evidence: z.array(EvidenceSchema),
    stepNo: z.number().int().positive().optional(),
    command: z.string().optional(),
    expectedResult: z.string().optional(),
    troubleshooting: z.string().optional(),
  })
  .refine((block) => block.kind !== "fact" || block.evidence.length > 0, {
    message: "fact 블록은 근거가 1개 이상이어야 합니다",
  });
export type ManualBlock = z.infer<typeof ManualBlockSchema>;

export const ManualSectionSchema = z.object({
  id: SectionIdSchema,
  title: z.string().min(1),
  status: z.enum(["found", "partial", "not_found"]),
  blocks: z.array(ManualBlockSchema),
});
export type ManualSection = z.infer<typeof ManualSectionSchema>;

export const LevelExtrasSchema = z.discriminatedUnion("level", [
  z.object({
    level: z.literal("beginner"),
    glossary: z.array(z.object({ term: z.string(), explanation: z.string() })),
    prerequisites: z.array(z.object({ topic: z.string(), explanation: z.string() })),
  }),
  z.object({
    level: z.literal("vibe_coder"),
    contextSummary: z.string(),
    relatedFiles: z.array(z.object({ path: z.string(), why: z.string(), url: z.url() })),
    promptExamples: z.array(z.object({ title: z.string(), prompt: z.string() })),
    checklist: z.array(z.string()),
  }),
  z.object({ level: z.literal("developer") }),
]);
export type LevelExtras = z.infer<typeof LevelExtrasSchema>;

export const ManualSchema = z
  .object({
    analysisId: z.uuid(),
    language: z.literal("ko"),
    level: LevelSchema,
    purpose: PurposeSchema,
    repo: z.object({
      owner: z.string().min(1),
      name: z.string().min(1),
      ref: z.string().min(1),
      commitSha: z.string().regex(COMMIT_SHA_PATTERN),
      htmlUrl: z.url(),
    }),
    title: z.string().min(1),
    overview: z.string(),
    sections: z.array(ManualSectionSchema),
    levelExtras: LevelExtrasSchema,
    limitations: z.array(z.string()),
    generatedAt: z.iso.datetime(),
    model: z.string().min(1),
    promptVersion: z.string().min(1),
  })
  .superRefine((manual, ctx) => {
    if (manual.levelExtras.level !== manual.level) {
      ctx.addIssue({ code: "custom", message: "levelExtras.level은 level과 같아야 합니다" });
    }
    const expected = sectionIdsFor(manual.purpose);
    const actual = manual.sections.map((section) => section.id);
    if (expected.join(",") !== actual.join(",")) {
      ctx.addIssue({
        code: "custom",
        message: `sections는 목적별 카탈로그 순서(${expected.join(", ")})를 빠짐없이 따라야 합니다`,
      });
    }
  });
export type Manual = z.infer<typeof ManualSchema>;
