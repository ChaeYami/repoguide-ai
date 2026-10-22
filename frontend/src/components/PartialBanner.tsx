import type { AnalysisDetail } from "@repoguide/shared";

// 부분 완료 안내 (FR-028, Constitution II). 사유는 백엔드 고정 문구를 그대로 보여 준다.

export function PartialBanner({ reasons, limitations }: { reasons: AnalysisDetail["partialReasons"]; limitations: string[] }) {
  const lines = [...new Set([...reasons.map((reason) => reason.message), ...limitations])];
  if (lines.length === 0) return null;
  return (
    <div role="status" className="mt-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-semibold">{reasons.length > 0 ? "일부만 분석된 매뉴얼입니다" : "분석 범위 안내"}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
