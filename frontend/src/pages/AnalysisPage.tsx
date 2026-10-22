import type { RegenerationRequest } from "@repoguide/shared";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ApiRequestError } from "../api/client";
import { isActive, useAnalysis, useFreshness, useManual, useRegenerate, useTrace } from "../api/queries";
import { ManualView } from "../components/ManualView";
import { FailureNotice } from "../components/FailureNotice";
import { FreshnessBanner } from "../components/FreshnessBanner";
import { PartialBanner } from "../components/PartialBanner";
import { ProgressStepper } from "../components/ProgressStepper";
import { RegeneratePanel } from "../components/RegeneratePanel";
import { TracePanel } from "../components/TracePanel";
import { VersionSwitcher } from "../components/VersionSwitcher";
import { LEVEL_LABELS, PURPOSE_LABELS, STATUS_LABELS } from "../lib/labels";
import { loadRecent, rememberAnalysis } from "../lib/recent-store";

// 분석 결과 화면: 진행 중 → 진행 표시, 실패 → 원인 안내, 완료·부분 완료 → 매뉴얼 (US1),
// "분석 내역" 탭 → 읽은 파일과 AI 탐색 판단 (US2), 버전·새 커밋 안내·재생성 (US5).

type Tab = "manual" | "trace";
const TABS: { value: Tab; label: string }[] = [
  { value: "manual", label: "매뉴얼" },
  { value: "trace", label: "분석 내역" },
];

export function AnalysisPage() {
  const { id = "" } = useParams();
  // 버전을 옮겨 다닐 때 탭·재생성 상태가 이전 분석의 것으로 남지 않도록 분석마다 새로 그린다.
  return <AnalysisView key={id} id={id} />;
}

function AnalysisView({ id }: { id: string }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("manual");
  const analysis = useAnalysis(id);
  const manual = useManual(id, analysis.data?.hasManual ?? false);
  const trace = useTrace(id, { enabled: tab === "trace" && analysis.isSuccess, status: analysis.data?.status });
  const freshness = useFreshness(id, Boolean(analysis.data?.hasManual && analysis.data.repo.commitSha));
  const regenerate = useRegenerate(id);
  const regenerateError = regenerate.error
    ? regenerate.error instanceof ApiRequestError
      ? regenerate.error.body
      : { message: "요청에 실패했습니다." }
    : null;
  const requestRegeneration = (request: RegenerationRequest) =>
    regenerate.mutate(request, { onSuccess: ({ id: newId }) => navigate(`/a/${newId}`) });

  // 만들거나 연 분석을 이 브라우저의 최근 목록에 남긴다 (US4).
  // 폴링할 때마다 다시 쓰지 않도록 분석마다 한 번만 기록한다.
  const remembered = useRef<string | null>(null);
  useEffect(() => {
    const summary = analysis.data;
    if (!summary || remembered.current === summary.id) return;
    remembered.current = summary.id;
    rememberAnalysis({ id: summary.id, owner: summary.repo.owner, name: summary.repo.name, level: summary.level, purpose: summary.purpose, createdAt: summary.createdAt });
  }, [analysis.data]);

  if (analysis.isPending) return <p className="text-slate-600">불러오는 중…</p>;
  if (analysis.isError) {
    const error = analysis.error instanceof ApiRequestError ? analysis.error.body : null;
    // 보관 기간이 지난 결과는 최근 목록에 남은 정보로 같은 조건의 분석을 바로 다시 시작할 수 있게 한다 (R17).
    const expired = error?.code === "expired";
    const previous = expired ? loadRecent().find((entry) => entry.id === id) : undefined;
    const retryLink = previous
      ? `/?${new URLSearchParams({ repo: `https://github.com/${previous.owner}/${previous.name}`, level: previous.level, purpose: previous.purpose })}`
      : "/";
    return (
      <div role="alert">
        <h1 className="text-2xl font-bold">{error?.message ?? "분석을 불러오지 못했습니다."}</h1>
        {error?.action && <p className="mt-2 text-slate-600">{error.action}</p>}
        {expired ? (
          <Link to={retryLink} className="mt-4 inline-block rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white">
            {previous ? `${previous.owner}/${previous.name} 다시 분석하기` : "다시 분석하기"}
          </Link>
        ) : (
          <Link to="/" className="mt-4 inline-block text-blue-700 underline">
            처음으로 돌아가기
          </Link>
        )}
      </div>
    );
  }

  const detail = analysis.data;
  return (
    <>
      <header>
        <p className="text-sm text-slate-500">{STATUS_LABELS[detail.status]}</p>
        <h1 className="break-all text-2xl font-bold">
          <a href={detail.repo.htmlUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
            {detail.repo.owner}/{detail.repo.name}
          </a>
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {LEVEL_LABELS[detail.level]} · {PURPOSE_LABELS[detail.purpose]}
          {detail.repo.ref ? ` · ${detail.repo.ref}` : ""}
          {detail.repo.subpath ? ` · ${detail.repo.subpath}` : ""}
        </p>
      </header>

      <VersionSwitcher versions={detail.versions} currentId={detail.id} />
      {freshness.data && (
        <FreshnessBanner freshness={freshness.data} pending={regenerate.isPending} onRefresh={() => requestRegeneration({ mode: "refresh_commit" })} />
      )}
      {regenerateError && regenerate.variables?.mode === "refresh_commit" && <FailureNotice title="다시 분석하지 못했습니다" {...regenerateError} />}
      {isActive(detail.status) && <ProgressStepper detail={detail} />}
      {detail.failure && <FailureNotice {...detail.failure} />}

      <div role="tablist" aria-label="결과 보기" className="mt-6 flex gap-1 border-b border-slate-200">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={`tab-${item.value}`}
            aria-selected={tab === item.value}
            aria-controls={`panel-${item.value}`}
            onClick={() => setTab(item.value)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === item.value ? "border-blue-700 text-blue-700" : "border-transparent text-slate-600 hover:text-slate-900"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "manual" &&
          (detail.hasManual ? (
            <>
              <PartialBanner reasons={detail.partialReasons} limitations={manual.data?.limitations ?? []} />
              {manual.isPending && <p className="mt-6 text-slate-600">매뉴얼을 불러오는 중…</p>}
              {manual.data && <ManualView manual={manual.data} />}
              <RegeneratePanel
                level={detail.level}
                purpose={detail.purpose}
                pending={regenerate.isPending}
                error={regenerate.variables?.mode === "change_options" ? regenerateError : null}
                onRegenerate={requestRegeneration}
              />
            </>
          ) : (
            <p className="mt-6 text-sm text-slate-600">
              {isActive(detail.status) ? "분석이 끝나면 매뉴얼이 여기에 표시됩니다." : "만들어진 매뉴얼이 없습니다."}
            </p>
          ))}
        {tab === "trace" &&
          (trace.data ? (
            <TracePanel trace={trace.data} />
          ) : (
            <p className="mt-6 text-sm text-slate-600">{trace.isError ? "분석 내역을 불러오지 못했습니다." : "분석 내역을 불러오는 중…"}</p>
          ))}
      </div>
    </>
  );
}
