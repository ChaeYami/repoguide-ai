import type { ModelPrice } from "../config/pricing.js";
import type { LlmUsage, ThinkingLevel } from "./client.js";

// 사전 추정은 실제보다 크게 잡아 비용 상한을 넘지 않게 한다 (Constitution VI, SC-008).

/** ASCII는 3자당 1토큰, 한글 등 비ASCII는 1자당 1토큰으로 보수적으로 센다. */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) < 128) ascii += 1;
    else other += 1;
  }
  return Math.ceil(ascii / 3) + other;
}

/** max_output_tokens에 사고 토큰이 포함되는지 모델마다 다를 수 있어 별도 여유분을 더한다. */
export const THINKING_ALLOWANCE: Record<ThinkingLevel, number> = {
  minimal: 512,
  low: 2_048,
  medium: 8_192,
  high: 24_576,
};

export interface CallEstimate {
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export function estimateCall(
  price: ModelPrice,
  input: { text: string; maxOutputTokens: number; thinkingLevel: ThinkingLevel },
): CallEstimate {
  const inputTokens = estimateTokens(input.text);
  const outputTokens = input.maxOutputTokens + THINKING_ALLOWANCE[input.thinkingLevel];
  return {
    inputTokens,
    outputTokens,
    costUsd: (inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1_000_000,
  };
}

export function actualCost(price: ModelPrice, usage: Pick<LlmUsage, "inputTokens" | "outputTokens" | "thoughtTokens">): number {
  return (
    (usage.inputTokens * price.inputPerMTok + (usage.outputTokens + usage.thoughtTokens) * price.outputPerMTok) /
    1_000_000
  );
}
