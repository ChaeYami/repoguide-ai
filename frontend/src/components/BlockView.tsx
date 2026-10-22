import type { ManualBlock } from "@repoguide/shared";
import { EvidenceChip } from "./EvidenceChip";
import { FactBadge } from "./FactBadge";
import { SafeMarkdown } from "./SafeMarkdown";

export function BlockView({ block }: { block: ManualBlock }) {
  return (
    <div className="rounded-lg border border-slate-200 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {block.type === "step" && block.stepNo !== undefined && (
          <span className="text-sm font-semibold text-slate-700">단계 {block.stepNo}</span>
        )}
        <FactBadge kind={block.kind} downgraded={block.downgraded} />
      </div>
      <SafeMarkdown>{block.markdown}</SafeMarkdown>
      {block.command && (
        <pre className="mt-2 overflow-x-auto rounded bg-slate-900 p-3 text-sm text-slate-100">
          <code>{block.command}</code>
        </pre>
      )}
      {block.expectedResult && (
        <p className="mt-2 text-sm">
          <span className="font-semibold text-emerald-800">정상 결과 </span>
          {block.expectedResult}
        </p>
      )}
      {block.troubleshooting && (
        <p className="mt-1 text-sm">
          <span className="font-semibold text-amber-800">문제가 생기면 </span>
          {block.troubleshooting}
        </p>
      )}
      {block.evidence.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1" aria-label="근거">
          {block.evidence.map((evidence) => (
            <EvidenceChip key={`${evidence.path}:${evidence.startLine}`} evidence={evidence} />
          ))}
        </div>
      )}
    </div>
  );
}
