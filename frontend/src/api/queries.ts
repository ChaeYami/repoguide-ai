import type { AnalysisStatus } from "@repoguide/shared";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, ApiRequestError } from "./client";

// 서버 상태 훅. 진행 중인 분석만 2초 간격으로 폴링하고 종료 상태에서 멈춘다 (FR-018, research R11).

export const POLL_INTERVAL_MS = 2_000;

export function isActive(status: AnalysisStatus): boolean {
  return status === "queued" || status === "running";
}

export function pollInterval(status: AnalysisStatus | undefined): number | false {
  return status !== undefined && isActive(status) ? POLL_INTERVAL_MS : false;
}

/** 404·410은 다시 시도해도 같으므로 재시도하지 않는다. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && (error.status === 404 || error.status === 410)) return false;
  return failureCount < 2;
}

export function useAnalysis(id: string) {
  return useQuery({
    queryKey: ["analysis", id],
    queryFn: () => api.getAnalysis(id),
    refetchInterval: (query) => pollInterval(query.state.data?.status),
    retry: shouldRetry,
  });
}

export function useManual(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["manual", id],
    queryFn: () => api.getManual(id),
    enabled,
    staleTime: Infinity,
    retry: shouldRetry,
  });
}

export function useCreateAnalysis() {
  return useMutation({ mutationFn: api.createAnalysis });
}
