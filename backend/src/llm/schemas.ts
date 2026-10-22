import { CoverageStatusSchema, type Purpose, sectionIdsFor } from "@repoguide/shared";
import { z } from "zod";

// LLM 출력 스키마 (contracts/llm-io.md). 섹션 id는 목적별 enum으로 제한해 카탈로그 밖 섹션을 만들 수 없게 한다.
// 배열 중첩은 3단계 이하로 유지한다(Gemini의 스키마 복잡도 제한).

const LineRange = {
  startLine: z.number().int(),
  endLine: z.number().int(),
};

function sectionIdEnum(purpose: Purpose) {
  const ids = sectionIdsFor(purpose);
  return z.enum(ids as [string, ...string[]]);
}

export function decideOutputSchema(purpose: Purpose) {
  return z.object({
    fileNotes: z.array(
      z.object({
        path: z.string(),
        summary: z.string(),
        facts: z.array(z.object({ text: z.string(), ...LineRange })),
      }),
    ),
    coverage: z.array(z.object({ sectionId: sectionIdEnum(purpose), status: CoverageStatusSchema, note: z.string() })),
    sufficient: z.boolean(),
    requests: z.array(z.object({ path: z.string(), reason: z.string() })),
    expandDirectories: z.array(z.string()),
  });
}
export type DecideOutput = z.infer<ReturnType<typeof decideOutputSchema>>;

export function writeOutputSchema(purpose: Purpose) {
  return z.object({
    title: z.string(),
    overview: z.string(),
    sections: z.array(
      z.object({
        sectionId: sectionIdEnum(purpose),
        status: z.enum(["found", "partial", "not_found"]),
        blocks: z.array(
          z.object({
            type: z.enum(["text", "step"]),
            markdown: z.string(),
            kind: z.enum(["fact", "inference"]),
            evidence: z.array(z.object({ path: z.string(), ...LineRange })),
            stepNo: z.number().int().optional(),
            command: z.string().optional(),
            expectedResult: z.string().optional(),
            troubleshooting: z.string().optional(),
          }),
        ),
      }),
    ),
    levelExtras: z.object({
      glossary: z.array(z.object({ term: z.string(), explanation: z.string() })),
      prerequisites: z.array(z.object({ topic: z.string(), explanation: z.string() })),
      contextSummary: z.string(),
      relatedFiles: z.array(z.object({ path: z.string(), why: z.string() })),
      promptExamples: z.array(z.object({ title: z.string(), prompt: z.string() })),
      checklist: z.array(z.string()),
    }),
    limitations: z.array(z.string()),
  });
}
export type WriteOutput = z.infer<ReturnType<typeof writeOutputSchema>>;
