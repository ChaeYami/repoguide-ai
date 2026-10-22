import type { FreshnessResponse } from "@repoguide/shared";

// 분석 이후 새 커밋이 생겼는지 알리고, 최신 커밋으로 다시 분석하게 한다 (US4 #4, US5 #2).

export function FreshnessBanner(props: { freshness: FreshnessResponse; pending: boolean; onRefresh: () => void }) {
  if (!props.freshness.isOutdated) return null;
  const { analyzedCommitSha, latestCommitSha } = props.freshness;
  return (
    <div role="status" className="mt-6 flex flex-col gap-3 rounded-lg border border-sky-300 bg-sky-50 p-4 text-sm text-sky-900 sm:flex-row sm:items-center sm:justify-between">
      <p>
        분석 이후 저장소에 새 커밋이 있습니다 (<span className="font-mono">{analyzedCommitSha.slice(0, 7)}</span> →{" "}
        <span className="font-mono">{latestCommitSha.slice(0, 7)}</span>).
      </p>
      <button
        type="button"
        onClick={props.onRefresh}
        disabled={props.pending}
        className="shrink-0 rounded-lg bg-sky-700 px-3 py-2 font-semibold text-white disabled:bg-slate-300"
      >
        최신 커밋으로 다시 분석
      </button>
    </div>
  );
}
