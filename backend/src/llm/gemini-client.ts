import { GoogleGenAI } from "@google/genai";
import { estimateTokens } from "./cost.js";
import {
  addUsage,
  LlmError,
  type LlmClient,
  type LlmUsage,
  type StructuredRequest,
  type StructuredResult,
  toResponseJsonSchema,
  ZERO_USAGE,
} from "./client.js";

// Gemini Interactions API 어댑터 (research R3). store:false로 서버 측 저장을 끄고,
// temperature는 보내지 않는다(Gemini 3.6+에서 무시되고 경고가 붙음).

interface InteractionResponse {
  output_text?: string | undefined;
  usage?: {
    total_input_tokens?: number | undefined;
    total_output_tokens?: number | undefined;
    total_thought_tokens?: number | undefined;
  } | undefined;
}

/** 테스트에서 바꿔 끼울 수 있도록 SDK 중 쓰는 부분만 정의한다. */
export interface InteractionsApi {
  create(params: Record<string, unknown>): Promise<InteractionResponse>;
}

export interface GeminiClientOptions {
  apiKey?: string;
  api?: InteractionsApi;
  sleep?: (ms: number) => Promise<void>;
}

// 분당 한도(RPM·TPM)는 수십 초 뒤에 풀리므로 짧은 백오프로는 회복하지 못한다(T048 평가에서 확인).
const TRANSIENT_BACKOFF_MS = [5_000, 15_000, 45_000];
/** 429 응답이 알려 주는 대기 시간도 이보다 길면 기다리지 않는다(실행 시간 상한 안에서 끝내기 위해). */
const MAX_RETRY_DELAY_MS = 90_000;

/** Gemini 429 응답의 RetryInfo(예: "retryDelay": "41s")에서 대기 시간을 읽는다. */
export function retryDelayMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const match = /retryDelay\\?"?\s*:\s*\\?"(\d+(?:\.\d+)?)s/.exec(message);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}
const MAX_SCHEMA_RETRIES = 1;

function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown })?.status;
  return typeof status === "number" ? status : undefined;
}

function classify(error: unknown): { code: "llm_rate_limited" | "llm_unavailable"; transient: boolean } {
  const status = statusOf(error);
  if (status === 429) return { code: "llm_rate_limited", transient: true };
  if (status === undefined || status >= 500) return { code: "llm_unavailable", transient: true };
  // 400(스키마 과다 등), 401/403(키 문제)은 재시도해도 같으므로 바로 실패한다.
  return { code: "llm_unavailable", transient: false };
}

function usageOf(response: InteractionResponse, promptText: string): LlmUsage {
  const reportedInput = response.usage?.total_input_tokens ?? 0;
  return {
    inputTokens: reportedInput > 0 ? reportedInput : estimateTokens(promptText),
    outputTokens: response.usage?.total_output_tokens ?? 0,
    thoughtTokens: response.usage?.total_thought_tokens ?? 0,
    usageEstimated: reportedInput <= 0,
  };
}

function parseJson(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "JSON 파싱 실패" };
  }
}

export class GeminiClient implements LlmClient {
  private readonly api: InteractionsApi;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: GeminiClientOptions) {
    if (!options.api && !options.apiKey) throw new Error("GEMINI_API_KEY가 필요합니다");
    this.api =
      options.api ??
      ((new GoogleGenAI({ apiKey: options.apiKey }).interactions as unknown) as InteractionsApi);
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const schema = toResponseJsonSchema(request.schema);
    let usage = ZERO_USAGE;
    let attempts = 0;
    let transientRetries = 0;
    let schemaRetries = 0;
    let input = request.input;

    for (;;) {
      attempts += 1;
      let response: InteractionResponse;
      try {
        response = await this.api.create({
          model: request.model,
          system_instruction: request.systemInstruction,
          input,
          response_format: { type: "text", mime_type: "application/json", schema },
          generation_config: {
            max_output_tokens: request.maxOutputTokens,
            thinking_level: request.thinkingLevel,
          },
          store: false,
        });
      } catch (error) {
        const { code, transient } = classify(error);
        if (transient && transientRetries < TRANSIENT_BACKOFF_MS.length) {
          const backoff = TRANSIENT_BACKOFF_MS[transientRetries++]!;
          const suggested = code === "llm_rate_limited" ? retryDelayMs(error) : null;
          await this.sleep(Math.min(MAX_RETRY_DELAY_MS, Math.max(backoff, (suggested ?? 0) + 1_000)));
          continue;
        }
        // 진단용 상세(서버 로그 전용). 사용자 안내는 고정 문구를 쓴다.
        const message = error instanceof Error ? error.message.slice(0, 300) : "";
        throw new LlmError(code, usage, [statusOf(error) ? `HTTP ${statusOf(error)}` : "", message].filter(Boolean).join(" "));
      }

      usage = addUsage(usage, usageOf(response, request.systemInstruction + input));
      const parsed = parseJson(response.output_text ?? "");
      const validated = parsed.ok ? request.schema.safeParse(parsed.value) : null;
      if (validated?.success) return { data: validated.data, usage, attempts };

      const problem = parsed.ok
        ? (validated?.error.issues ?? [])
            .slice(0, 5)
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("; ")
        : parsed.error;
      if (schemaRetries >= MAX_SCHEMA_RETRIES) throw new LlmError("llm_invalid_output", usage, problem);
      schemaRetries += 1;
      input = `${request.input}\n\n[이전 응답이 출력 스키마를 따르지 않았습니다: ${problem}. 스키마에 맞는 JSON만 출력하세요.]`;
    }
  }
}
