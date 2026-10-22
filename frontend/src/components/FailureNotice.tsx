import type { AnalysisDetail } from "@repoguide/shared";

// 실패 안내 (FR-028). 메시지와 조치는 백엔드 고정 문구다.

export function FailureNotice({ failure }: { failure: NonNullable<AnalysisDetail["failure"]> }) {
  return (
    <div role="alert" className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">
      <p className="font-semibold">분석을 완료하지 못했습니다</p>
      <p className="mt-2">{failure.message}</p>
      <p className="mt-1 text-sm">{failure.action}</p>
    </div>
  );
}
