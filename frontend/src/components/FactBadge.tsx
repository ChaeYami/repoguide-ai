// 확인된 사실과 추론을 구분해 표시한다 (FR-026, Constitution V).

export function FactBadge({ kind, downgraded }: { kind: "fact" | "inference"; downgraded: boolean }) {
  if (kind === "fact") {
    return <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800">확인됨</span>;
  }
  return (
    <span
      className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
      title={downgraded ? "근거를 확인하지 못해 추론으로 표시했습니다" : "파일 내용으로부터 추정한 설명입니다"}
    >
      {downgraded ? "추론(근거 확인 실패)" : "추론"}
    </span>
  );
}
