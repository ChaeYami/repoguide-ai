import { z } from "zod";

// 코드 ↔ LLM 경계 (contracts/llm-io.md). LLM 호출은 이 인터페이스를 통해서만 한다.

export type LlmRole = "decide" | "write";
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  thoughtTokens: number;
  /** 서비스가 입력 토큰을 0으로 보고해 추정치로 대신한 경우 */
  usageEstimated: boolean;
}

export const ZERO_USAGE: LlmUsage = { inputTokens: 0, outputTokens: 0, thoughtTokens: 0, usageEstimated: false };

export function addUsage(a: LlmUsage, b: LlmUsage): LlmUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thoughtTokens: a.thoughtTokens + b.thoughtTokens,
    usageEstimated: a.usageEstimated || b.usageEstimated,
  };
}

export interface StructuredRequest<T> {
  role: LlmRole;
  model: string;
  systemInstruction: string;
  input: string;
  schema: z.ZodType<T>;
  maxOutputTokens: number;
  thinkingLevel: ThinkingLevel;
}

export interface StructuredResult<T> {
  data: T;
  /** 재시도까지 합친 사용량 */
  usage: LlmUsage;
  attempts: number;
}

export type LlmErrorCode = "llm_rate_limited" | "llm_unavailable" | "llm_invalid_output";

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    /** 실패하기까지 쓴 사용량. 비용 집계에 포함한다. */
    readonly usage: LlmUsage,
    detail?: string,
  ) {
    super(`LLM error: ${code}${detail ? ` (${detail})` : ""}`);
    this.name = "LlmError";
  }
}

export interface LlmClient {
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
}

/** Gemini 구조화 출력용 JSON Schema. 지원하지 않는 메타 필드는 뺀다. */
export function toResponseJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "output" }) as Record<string, unknown>;
  return rest;
}
