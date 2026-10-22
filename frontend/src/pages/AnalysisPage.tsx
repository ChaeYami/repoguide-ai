import { Link, useParams } from "react-router";
import { ApiRequestError } from "../api/client";
import { isActive, useAnalysis, useManual } from "../api/queries";
import { ManualView } from "../components/ManualView";
import { FailureNotice } from "../components/FailureNotice";
import { PartialBanner } from "../components/PartialBanner";
import { ProgressStepper } from "../components/ProgressStepper";
import { LEVEL_LABELS, PURPOSE_LABELS, STATUS_LABELS } from "../lib/labels";

// 분석 결과 화면: 진행 중 → 진행 표시, 실패 → 원인 안내, 완료·부분 완료 → 매뉴얼 (US1).
// 분석 내역·재생성·버전은 US2·US5에서 추가한다.

export function AnalysisPage() {
  const { id = "" } = useParams();
  const analysis = useAnalysis(id);
  const manual = useManual(id, analysis.data?.hasManual ?? false);

  if (analysis.isPending) return <p className="text-slate-600">불러오는 중…</p>;
  if (analysis.isError) {
    const error = analysis.error instanceof ApiRequestError ? analysis.error.body : null;
    return (
      <div role="alert">
        <h1 className="text-2xl font-bold">{error?.message ?? "분석을 불러오지 못했습니다."}</h1>
        {error?.action && <p className="mt-2 text-slate-600">{error.action}</p>}
        <Link to="/" className="mt-4 inline-block text-blue-700 underline">
          처음으로 돌아가기
        </Link>
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

      {isActive(detail.status) && <ProgressStepper detail={detail} />}
      {detail.failure && <FailureNotice failure={detail.failure} />}
      {detail.hasManual && (
        <>
          <PartialBanner reasons={detail.partialReasons} limitations={manual.data?.limitations ?? []} />
          {manual.isPending && <p className="mt-6 text-slate-600">매뉴얼을 불러오는 중…</p>}
          {manual.data && <ManualView manual={manual.data} />}
        </>
      )}
    </>
  );
}
