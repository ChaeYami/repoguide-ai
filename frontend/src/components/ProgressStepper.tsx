import type { AnalysisDetail } from "@repoguide/shared";
import { useEffect, useState } from "react";
import { ACTIVITY_LABELS, formatElapsed, STAGE_STEPS } from "../lib/labels";

// 진행 상태 (FR-018, SC-002). 경과 시간은 브라우저가 1초마다 다시 계산한다(research R11).

function useNow(intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function ProgressStepper({ detail }: { detail: AnalysisDetail }) {
  const now = useNow();
  const currentIndex = STAGE_STEPS.findIndex((step) => step.stage === detail.stage);
  const { progress } = detail;
  const elapsed = formatElapsed(now - new Date(detail.createdAt).getTime());

  return (
    <div className="mt-6 rounded-lg border border-slate-200 p-4" aria-live="polite">
      <ol className="flex flex-wrap gap-2 text-sm">
        {STAGE_STEPS.map((step, index) => {
          const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "todo";
          return (
            <li
              key={step.stage}
              aria-current={state === "current" ? "step" : undefined}
              className={`rounded-full px-3 py-1 ${
                state === "current"
                  ? "bg-blue-700 font-semibold text-white"
                  : state === "done"
                    ? "bg-blue-100 text-blue-900"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              {step.label}
              {step.stage === "exploring_more" && state === "current" ? ` ${progress.round}/${progress.maxRounds}` : ""}
            </li>
          );
        })}
      </ol>
      <div className="mt-4 space-y-1 text-sm text-slate-700">
        {detail.status === "queued" ? (
          <p>
            대기 순서 {detail.queuePosition ?? 1}번째 · 대기 {elapsed}
          </p>
        ) : (
          <>
            <p>{progress.activity ? ACTIVITY_LABELS[progress.activity] : "진행 중"} · 경과 {elapsed}</p>
            <p>
              읽은 파일 {progress.filesRead}개{progress.round > 0 ? ` · 탐색 라운드 ${progress.round}/${progress.maxRounds}` : ""}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
