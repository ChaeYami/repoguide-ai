import type { AnalysisStatus, RegenerationRequest } from "@repoguide/shared";
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

/** 분석 내역. 탭을 열었을 때만 불러오고, 분석이 진행 중이면 함께 폴링한다. */
export function useTrace(id: string, options: { enabled: boolean; status: AnalysisStatus | undefined }) {
  return useQuery({
    queryKey: ["trace", id],
    queryFn: () => api.getTrace(id),
    enabled: options.enabled,
    refetchInterval: pollInterval(options.status),
    retry: shouldRetry,
  });
}

/** 최근 목록의 현재 상태. 진행 중인 항목이 있으면 함께 폴링한다. */
export function useRecentStatuses(ids: string[]) {
  return useQuery({
    queryKey: ["recent", ids],
    queryFn: () => api.getBatch(ids),
    enabled: ids.length > 0,
    refetchInterval: (query) => (query.state.data?.items.some((item) => isActive(item.status)) ? POLL_INTERVAL_MS : false),
    retry: shouldRetry,
  });
}

/** 분석 이후 새 커밋이 생겼는지 (US5). 서버가 5분간 캐시한다. */
export function useFreshness(id: string, enabled: boolean) {
  return useQuery({
    queryKey: ["freshness", id],
    queryFn: () => api.getFreshness(id),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
}

export function useRegenerate(id: string) {
  return useMutation({ mutationFn: (request: RegenerationRequest) => api.regenerate(id, request) });
}

export function useCreateAnalysis() {
  return useMutation({ mutationFn: api.createAnalysis });
}
