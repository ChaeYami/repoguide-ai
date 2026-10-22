import type { Limits } from "../config/limits.js";
import type { Quota } from "../db/repositories/analyses.js";

// 사용량 보호 기준 시각 (FR-034, FR-035, research R5·R16). 일일 비용은 한국 시간 자정에 초기화한다.

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000; // Asia/Seoul은 일광 절약 시간이 없다.

export function kstDayStart(now: Date): Date {
  return new Date(Math.floor((now.getTime() + KST_OFFSET_MS) / DAY_MS) * DAY_MS - KST_OFFSET_MS);
}

export function quotaFor(limits: Limits, now: Date): Quota {
  return {
    clientWindowStart: new Date(now.getTime() - DAY_MS),
    clientLimit: limits.requestsPerClientPerDay,
    dayStart: kstDayStart(now),
    dailyLimitUsd: limits.dailyCostUsd,
    reserveUsd: limits.maxCostUsdPerRun,
  };
}

/** 창 안에서 가장 오래된 요청이 24시간을 벗어나는 시각까지 */
export function rateLimitRetryAfterSec(oldestInWindow: Date, now: Date): number {
  return Math.max(1, Math.ceil((oldestInWindow.getTime() + DAY_MS - now.getTime()) / 1000));
}

/** 다음 한국 시간 자정까지 */
export function dailyBudgetRetryAfterSec(now: Date): number {
  return Math.max(1, Math.ceil((kstDayStart(now).getTime() + DAY_MS - now.getTime()) / 1000));
}
