import { useState } from "react";
import { Link } from "react-router";
import { useRecentStatuses } from "../api/queries";
import { LEVEL_LABELS, PURPOSE_LABELS, STATUS_LABELS } from "../lib/labels";
import { forgetAnalysis, loadRecent, type RecentEntry } from "../lib/recent-store";

// 이 브라우저에서 만들거나 연 분석 (FR-030, US4). 상태는 서버에서 일괄 조회하고, 없어진 결과는 "만료됨"으로 표시한다.

const DATE = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

export function RecentList() {
  const [entries, setEntries] = useState<RecentEntry[]>(() => loadRecent());
  const statuses = useRecentStatuses(entries.map((entry) => entry.id));
  if (entries.length === 0) return null;

  const byId = new Map(statuses.data?.items.map((item) => [item.id, item]) ?? []);
  const missing = new Set(statuses.data?.missingIds ?? []);

  return (
    <section aria-labelledby="recent-heading" className="mt-10">
      <h2 id="recent-heading" className="text-lg font-semibold">
        최근 분석
      </h2>
      <ul className="mt-3 space-y-2">
        {entries.map((entry) => {
          const status = missing.has(entry.id) ? "만료됨" : byId.get(entry.id) ? STATUS_LABELS[byId.get(entry.id)!.status] : null;
          return (
            <li key={entry.id} className="flex items-start justify-between gap-3 rounded-lg border border-slate-200 p-3 text-sm">
              <div className="min-w-0">
                {missing.has(entry.id) ? (
                  <span className="break-all font-medium text-slate-500">
                    {entry.owner}/{entry.name}
                  </span>
                ) : (
                  <Link to={`/a/${entry.id}`} className="break-all font-medium text-blue-700 underline">
                    {entry.owner}/{entry.name}
                  </Link>
                )}
                <p className="mt-1 text-slate-600">
                  {LEVEL_LABELS[entry.level]} · {PURPOSE_LABELS[entry.purpose]} · {DATE.format(new Date(entry.createdAt))}
                  {status && ` · ${status}`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEntries(forgetAnalysis(entry.id))}
                aria-label={`${entry.owner}/${entry.name} 목록에서 지우기`}
                className="shrink-0 text-xs text-slate-500 hover:text-slate-900"
              >
                지우기
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
