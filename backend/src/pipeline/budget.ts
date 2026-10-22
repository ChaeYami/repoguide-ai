import type { StopReason, Usage } from "@repoguide/shared";
import type { Limits } from "../config/limits.js";
import { type ModelPrice, priceFor } from "../config/pricing.js";
import type { LlmUsage } from "../llm/client.js";
import { actualCost, type CallEstimate } from "../llm/cost.js";

// 실행 단위 예산 (Constitution VI, research R5). 모든 GitHub·LLM 호출 직전에 코드가 검사한다.

export type LimitStopReason = Exclude<StopReason, "sufficient" | "no_more_candidates">;

/** 한도 때문에 탐색이 멈췄는지 (상태 판정·분석 내역의 limitReached가 같은 기준을 쓴다) */
export function isLimitStop(reason: StopReason | null | undefined): reason is LimitStopReason {
  return reason != null && reason !== "sufficient" && reason !== "no_more_candidates";
}
export type BudgetCheck = { ok: true } | { ok: false; reason: LimitStopReason };

const OK: BudgetCheck = { ok: true };

export class BudgetGuard {
  private usage: Usage = {
    rounds: 0,
    filesRead: 0,
    githubCalls: 0,
    inputTokens: 0,
    outputTokens: 0,
    thoughtTokens: 0,
    costUsd: 0,
    usageEstimated: false,
  };

  constructor(
    readonly limits: Limits,
    private readonly priceOf: (model: string) => ModelPrice = (model) => priceFor(model),
  ) {}

  snapshot(): Usage {
    return { ...this.usage };
  }

  // ── 라운드 ──
  canStartRound(): BudgetCheck {
    return this.usage.rounds < this.limits.maxRounds ? OK : { ok: false, reason: "round_limit" };
  }

  recordRound() {
    this.usage.rounds += 1;
  }

  // ── 파일 ──
  remainingFiles(): number {
    return Math.max(0, this.limits.maxFiles - this.usage.filesRead);
  }

  recordFilesRead(count: number) {
    this.usage.filesRead += count;
  }

  // ── GitHub ──
  remainingGithubCalls(): number {
    return Math.max(0, this.limits.maxGithubCalls - this.usage.githubCalls);
  }

  canCallGithub(count = 1): BudgetCheck {
    return this.remainingGithubCalls() >= count ? OK : { ok: false, reason: "github_call_limit" };
  }

  recordGithubCall() {
    this.usage.githubCalls += 1;
  }

  // ── LLM ──
  /** 사전 추정(estimateCall)이 남은 토큰·비용 안에 들어올 때만 호출을 허락한다. */
  canCallLlm(estimate: CallEstimate): BudgetCheck {
    if (this.usage.inputTokens + estimate.inputTokens > this.limits.maxInputTokens) {
      return { ok: false, reason: "token_limit" };
    }
    if (this.usage.outputTokens + this.usage.thoughtTokens + estimate.outputTokens > this.limits.maxOutputTokens) {
      return { ok: false, reason: "token_limit" };
    }
    if (this.usage.costUsd + estimate.costUsd > this.limits.maxCostUsdPerRun) {
      return { ok: false, reason: "cost_limit" };
    }
    return OK;
  }

  /** 실제 사용량을 기록한다(실패한 호출의 사용량도 포함). 반환값은 이 호출의 비용. */
  recordLlm(model: string, usage: LlmUsage): number {
    const cost = actualCost(this.priceOf(model), usage);
    this.usage.inputTokens += usage.inputTokens;
    this.usage.outputTokens += usage.outputTokens;
    this.usage.thoughtTokens += usage.thoughtTokens;
    this.usage.costUsd += cost;
    this.usage.usageEstimated ||= usage.usageEstimated;
    return cost;
  }
}
