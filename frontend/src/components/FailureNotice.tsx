import { formatRetryAfter } from "../lib/labels";

// 실패·거절 안내 (FR-028, FR-034, FR-035). 메시지와 조치는 백엔드 고정 문구이고, 재시도 시각은 한국 시간으로 보여 준다.

export interface FailureNoticeProps {
  title?: string;
  message: string;
  action?: string | null;
  retryAfterSec?: number | null;
}

export function FailureNotice({ title = "분석을 완료하지 못했습니다", message, action, retryAfterSec }: FailureNoticeProps) {
  return (
    <div role="alert" className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-red-900">
      <p className="font-semibold">{title}</p>
      <p className="mt-2">{message}</p>
      {action && <p className="mt-1 text-sm">{action}</p>}
      {retryAfterSec != null && retryAfterSec > 0 && <p className="mt-1 text-sm font-medium">{formatRetryAfter(retryAfterSec)}</p>}
    </div>
  );
}
