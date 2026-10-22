import type { Evidence } from "@repoguide/shared";

// 근거 파일·라인 링크 (FR-024). URL은 분석 커밋 SHA로 고정되어 있다.

export function EvidenceChip({ evidence }: { evidence: Evidence }) {
  const range = evidence.startLine === evidence.endLine ? `L${evidence.startLine}` : `L${evidence.startLine}-L${evidence.endLine}`;
  return (
    <a
      href={evidence.url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-block max-w-full break-all rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-xs text-slate-700 hover:border-blue-600"
    >
      {evidence.path}:{range}
    </a>
  );
}
