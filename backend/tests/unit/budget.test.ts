import { describe, expect, it } from "vitest";
import { parseLimits } from "../../src/config/limits.js";
import { estimateCall } from "../../src/llm/cost.js";
import { BudgetGuard } from "../../src/pipeline/budget.js";

const PRICE = { inputPerMTok: 0.75, outputPerMTok: 3.75 };
const guard = (overrides: Record<string, string> = {}) => new BudgetGuard(parseLimits(overrides), () => PRICE);

describe("BudgetGuard", () => {
  it("allows maxRounds read rounds and then reports round_limit", () => {
    const budget = guard({ LIMIT_MAX_ROUNDS: "2" });
    for (let i = 0; i < 2; i += 1) {
      expect(budget.canStartRound()).toEqual({ ok: true });
      budget.recordRound();
    }
    expect(budget.canStartRound()).toEqual({ ok: false, reason: "round_limit" });
  });

  it("tracks remaining files and GitHub calls", () => {
    const budget = guard({ LIMIT_MAX_FILES: "5", LIMIT_MAX_GITHUB_CALLS: "3" });
    budget.recordFilesRead(4);
    expect(budget.remainingFiles()).toBe(1);
    budget.recordFilesRead(3);
    expect(budget.remainingFiles()).toBe(0);
    budget.recordGithubCall();
    budget.recordGithubCall();
    expect(budget.canCallGithub(1)).toEqual({ ok: true });
    expect(budget.canCallGithub(2)).toEqual({ ok: false, reason: "github_call_limit" });
  });

  it("blocks an LLM call whose estimate would exceed the cost cap", () => {
    // 작은 호출 추정 ≈ $0.0103(사고 여유분 포함), 큰 호출 ≈ $0.0302
    const budget = guard({ LIMIT_MAX_COST_USD_PER_RUN: "0.02" });
    const small = estimateCall(PRICE, { text: "x".repeat(3_000), maxOutputTokens: 500, thinkingLevel: "low" });
    expect(budget.canCallLlm(small)).toEqual({ ok: true });
    const big = estimateCall(PRICE, { text: "x".repeat(30_000), maxOutputTokens: 4_000, thinkingLevel: "low" });
    expect(budget.canCallLlm(big)).toEqual({ ok: false, reason: "cost_limit" });
  });

  it("blocks on input and output token caps before cost", () => {
    const budget = guard({ LIMIT_MAX_INPUT_TOKENS: "1000", LIMIT_MAX_OUTPUT_TOKENS: "3000" });
    expect(budget.canCallLlm({ inputTokens: 1_001, outputTokens: 10, costUsd: 0 })).toEqual({ ok: false, reason: "token_limit" });
    expect(budget.canCallLlm({ inputTokens: 10, outputTokens: 3_001, costUsd: 0 })).toEqual({ ok: false, reason: "token_limit" });
  });

  it("records actual usage including thought tokens and returns the call cost", () => {
    const budget = guard();
    const cost = budget.recordLlm("m", { inputTokens: 100_000, outputTokens: 8_000, thoughtTokens: 2_000, usageEstimated: true });
    expect(cost).toBeCloseTo(0.1125, 10);
    expect(budget.snapshot()).toMatchObject({ inputTokens: 100_000, outputTokens: 8_000, thoughtTokens: 2_000, usageEstimated: true });
  });

  it("never lets the recorded cost exceed the per-run cap when usage stays within estimates (SC-008)", () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    // 입력은 최대 6만 자(≈$0.015)로 둔다. 추정 비용은 출력 상한(≈$0.07)이 대부분이라 상한 경계는 그대로 시험된다.
    const text = "y".repeat(60_000);
    for (let run = 0; run < 100; run += 1) {
      const budget = guard({ LIMIT_MAX_COST_USD_PER_RUN: (0.05 + random() * 0.3).toFixed(3) });
      for (let call = 0; call < 50; call += 1) {
        const estimate = estimateCall(PRICE, {
          text: text.slice(0, Math.floor(random() * text.length)),
          maxOutputTokens: Math.floor(500 + random() * 16_000),
          thinkingLevel: "low",
        });
        if (!budget.canCallLlm(estimate).ok) continue;
        budget.recordLlm("m", {
          inputTokens: Math.floor(estimate.inputTokens * random()),
          outputTokens: Math.floor((estimate.outputTokens / 2) * random()),
          thoughtTokens: Math.floor((estimate.outputTokens / 2) * random()),
          usageEstimated: false,
        });
        expect(budget.snapshot().costUsd).toBeLessThanOrEqual(budget.limits.maxCostUsdPerRun);
      }
    }
  });
});
