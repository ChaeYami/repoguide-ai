import type { AnalysisSummary } from "@repoguide/shared";
import { Link } from "react-router";
import { LEVEL_LABELS, PURPOSE_LABELS, STATUS_LABELS } from "../lib/labels";

// 같은 계보(처음 분석과 재생성들)의 버전 목록 (FR-033). 이전 매뉴얼도 계속 볼 수 있다.

const DATE = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

export function VersionSwitcher({ versions, currentId }: { versions: AnalysisSummary[]; currentId: string }) {
  if (versions.length < 2) return null;
  return (
    <nav aria-label="버전" className="mt-6">
      <h2 className="text-sm font-semibold text-slate-700">버전 {versions.length}개</h2>
      <ol className="mt-2 space-y-1 text-sm">
        {versions.map((version, index) => {
          const label = `v${index + 1} · ${LEVEL_LABELS[version.level]} · ${PURPOSE_LABELS[version.purpose]}`;
          const meta = [version.repo.commitSha?.slice(0, 7), STATUS_LABELS[version.status], DATE.format(new Date(version.createdAt))]
            .filter(Boolean)
            .join(" · ");
          return (
            <li key={version.id} className="break-words">
              {version.id === currentId ? (
                <span aria-current="page" className="font-semibold">
                  {label} (지금 보는 버전)
                </span>
              ) : (
                <Link to={`/a/${version.id}`} className="text-blue-700 underline">
                  {label}
                </Link>
              )}
              <span className="text-slate-500"> — {meta}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
