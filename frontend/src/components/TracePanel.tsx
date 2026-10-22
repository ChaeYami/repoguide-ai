import type { TraceResponse } from "@repoguide/shared";
import {
  COVERAGE_LABELS,
  FILE_SOURCE_LABELS,
  REJECT_REASON_LABELS,
  STOP_REASON_LABELS,
} from "../lib/labels";

// 분석 내역 (FR-011, FR-027, Constitution I·II): 어떤 파일을 왜 읽었는지, AI가 무엇을 판단했는지.

export function TracePanel({ trace }: { trace: TraceResponse }) {
  const { usage, limits } = trace;
  return (
    <div className="mt-6 space-y-8 break-words">
      <section aria-labelledby="trace-summary">
        <h2 id="trace-summary" className="text-xl font-semibold">
          요약
        </h2>
        <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          <div>
            <dt className="inline text-slate-500">분석 커밋 </dt>
            <dd className="inline font-mono">{trace.repo.commitSha ?? "확정 전"}</dd>
          </div>
          <div>
            <dt className="inline text-slate-500">종료 사유 </dt>
            <dd className="inline">
              {trace.stopReason ? STOP_REASON_LABELS[trace.stopReason] : "진행 중"}
              {trace.limitReached && (
                <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800">한도 도달</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">파일 </dt>
            <dd className="inline">
              전체 {trace.treeStats.entryCount}개 중 후보 {trace.treeStats.candidateCount}개
              {trace.treeStats.truncated ? " (저장소가 커서 일부만 수집)" : ""}
            </dd>
          </div>
          <div>
            <dt className="inline text-slate-500">사용량 </dt>
            <dd className="inline">
              라운드 {usage.rounds}/{limits.maxRounds ?? "-"} · 읽은 파일 {usage.filesRead}/{limits.maxFiles ?? "-"} · GitHub{" "}
              {usage.githubCalls}회 · ${usage.costUsd.toFixed(4)} / ${(limits.maxCostUsdPerRun ?? 0).toFixed(2)}
            </dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="trace-files">
        <h2 id="trace-files" className="text-xl font-semibold">
          읽은 파일 ({trace.files.length}개)
        </h2>
        {trace.files.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">아직 읽은 파일이 없습니다.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {trace.files.map((file) => (
              <li key={file.path} className="rounded-lg border border-slate-200 p-3 text-sm">
                <a href={file.githubUrl} target="_blank" rel="noopener noreferrer" className="break-all font-mono text-blue-700 underline">
                  {file.path}
                </a>
                <div className="mt-1 flex flex-wrap gap-1 text-xs">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{FILE_SOURCE_LABELS[file.source]}</span>
                  {file.roundNo > 0 && <span className="rounded bg-slate-100 px-1.5 py-0.5">{file.roundNo}라운드</span>}
                  {file.truncated && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-amber-800">앞부분만 읽음</span>}
                  <span className="rounded bg-slate-100 px-1.5 py-0.5">{file.contentIncludedInWrite ? "원문 반영" : "요약만 반영"}</span>
                </div>
                <p className="mt-1 text-slate-700">{file.reason}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="trace-decisions">
        <h2 id="trace-decisions" className="text-xl font-semibold">
          AI 탐색 판단
        </h2>
        {trace.decisions.length === 0 ? (
          <p className="mt-2 text-sm text-slate-600">아직 판단 기록이 없습니다.</p>
        ) : (
          <ol className="mt-3 space-y-4">
            {trace.decisions.map((decision) => (
              <li key={decision.decideNo} className="rounded-lg border border-slate-200 p-3 text-sm">
                <p className="font-semibold">
                  판단 #{decision.decideNo} — {decision.sufficient ? "정보 충분" : "추가 탐색 필요"}
                </p>
                {decision.coverage.length > 0 && (
                  <ul className="mt-2 flex flex-wrap gap-1 text-xs">
                    {decision.coverage.map((entry) => (
                      <li key={entry.sectionId} className="rounded bg-slate-100 px-1.5 py-0.5" title={entry.note}>
                        {entry.sectionId}: {COVERAGE_LABELS[entry.status]}
                      </li>
                    ))}
                  </ul>
                )}
                {decision.requests.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {decision.requests.map((request) => (
                      <li key={`${request.path}-${request.reason}`} className="break-all">
                        <span className={request.accepted ? "text-emerald-700" : "text-slate-500"}>{request.accepted ? "✓ 읽음" : "✗ 거절"}</span>{" "}
                        <span className="font-mono">{request.path}</span>
                        {request.rejectReason && <span className="text-slate-500"> ({REJECT_REASON_LABELS[request.rejectReason]})</span>}
                        <span className="text-slate-600"> — {request.reason}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {decision.expandedDirectories.length > 0 && (
                  <p className="mt-2 text-xs text-slate-600">펼쳐 본 디렉터리: {decision.expandedDirectories.join(", ")}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
