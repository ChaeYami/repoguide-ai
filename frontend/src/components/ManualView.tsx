import type { Manual } from "@repoguide/shared";
import { LevelExtrasView } from "./LevelExtrasView";
import { SafeMarkdown } from "./SafeMarkdown";
import { SectionView } from "./SectionView";

export function ManualView({ manual }: { manual: Manual }) {
  return (
    <article className="mt-6">
      <h2 className="text-2xl font-bold">{manual.title}</h2>
      <div className="mt-2 text-slate-700">
        <SafeMarkdown>{manual.overview}</SafeMarkdown>
      </div>
      <LevelExtrasView extras={manual.levelExtras} />
      {manual.sections.map((section) => (
        <SectionView key={section.id} section={section} />
      ))}
      <p className="mt-8 text-xs text-slate-500">
        분석 커밋 <span className="font-mono">{manual.repo.commitSha.slice(0, 7)}</span> · {manual.model}
      </p>
    </article>
  );
}
