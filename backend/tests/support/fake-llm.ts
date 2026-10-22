import {
  LlmError,
  type LlmClient,
  type LlmRole,
  type LlmUsage,
  type StructuredRequest,
  type StructuredResult,
} from "../../src/llm/client.js";

// 각본대로 응답하는 LLM. 응답은 요청 스키마로 검증하므로 실제 어댑터처럼 형식 오류를 낸다.

export type FakeLlmStep =
  | { data: unknown; usage?: Partial<LlmUsage> }
  | { error: LlmError }
  | ((request: StructuredRequest<unknown>) => { data: unknown; usage?: Partial<LlmUsage> });

export interface FakeLlmCall {
  role: LlmRole;
  model: string;
  systemInstruction: string;
  input: string;
  maxOutputTokens: number;
}

const DEFAULT_USAGE: LlmUsage = { inputTokens: 1_000, outputTokens: 200, thoughtTokens: 0, usageEstimated: false };

export class FakeLlmClient implements LlmClient {
  readonly calls: FakeLlmCall[] = [];
  private readonly queues: Record<LlmRole, FakeLlmStep[]>;

  constructor(script: Partial<Record<LlmRole, FakeLlmStep[]>>) {
    this.queues = { decide: [...(script.decide ?? [])], write: [...(script.write ?? [])] };
  }

  remaining(role: LlmRole): number {
    return this.queues[role].length;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push({
      role: request.role,
      model: request.model,
      systemInstruction: request.systemInstruction,
      input: request.input,
      maxOutputTokens: request.maxOutputTokens,
    });
    const step = this.queues[request.role].shift();
    if (!step) throw new Error(`FakeLlmClient: ${request.role} 각본이 더 없습니다`);
    if ("error" in step) throw step.error;
    const resolved = typeof step === "function" ? step(request as StructuredRequest<unknown>) : step;
    const usage = { ...DEFAULT_USAGE, ...resolved.usage };
    const parsed = request.schema.safeParse(resolved.data);
    if (!parsed.success) throw new LlmError("llm_invalid_output", usage, parsed.error.message);
    return { data: parsed.data, usage, attempts: 1 };
  }
}
