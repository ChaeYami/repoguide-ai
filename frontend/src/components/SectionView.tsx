import type { ManualSection } from "@repoguide/shared";
import { BlockView } from "./BlockView";

// 근거를 찾지 못한 항목은 "저장소에서 확인되지 않음"으로 표시하고,
// 일반 관행에 따른 안내(추론 블록)가 있으면 그 아래에 덧붙인다 (FR-022).

export function NotFoundNotice({ withGuidance = false }: { withGuidance?: boolean }) {
  return (
    <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm text-slate-600">
      저장소에서 확인되지 않음 — 이 항목에 해당하는 정보를 저장소 파일에서 찾지 못했습니다.
      {withGuidance && " 아래는 일반적인 관행에 따른 안내입니다."}
    </p>
  );
}

export function SectionView({ section }: { section: ManualSection }) {
  const hasFact = section.blocks.some((block) => block.kind === "fact");
  const unconfirmed = section.status === "not_found" || !hasFact;
  return (
    <section aria-labelledby={`section-${section.id}`} className="mt-8">
      <h2 id={`section-${section.id}`} className="flex flex-wrap items-center gap-2 text-xl font-semibold">
        {section.title}
        {section.status === "partial" && hasFact && (
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">일부만 확인됨</span>
        )}
      </h2>
      <div className="mt-3 space-y-3">
        {unconfirmed && <NotFoundNotice withGuidance={section.blocks.length > 0} />}
        {section.status !== "not_found" && section.blocks.map((block) => <BlockView key={block.id} block={block} />)}
      </div>
    </section>
  );
}
