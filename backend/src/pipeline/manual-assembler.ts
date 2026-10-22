import {
  type Level,
  type LevelExtras,
  type Manual,
  type ManualBlock,
  ManualSchema,
  type ManualSection,
  type Purpose,
  SECTION_CATALOG,
} from "@repoguide/shared";
import type { ManualStats } from "../db/json-types.js";
import { blobUrl, lineUrl } from "../github/permalink.js";
import type { WriteOutput } from "../llm/schemas.js";
import { validateEvidence } from "./citation-validator.js";
import { normalizePath } from "./request-validator.js";

// Write 출력 → Manual 조립 (research R8, contracts/manual.md 불변식). LLM이 정할 수 없는 것은 코드가 정한다:
// 섹션 목록·순서·제목, 근거 유효성, fact/inference 강등, 수준별 추가 요소, 코드 판정 한계 문구.

export const README_ONLY_LIMITATION = "README 외에 분석할 수 있는 파일이 없어 README 내용만으로 작성했습니다.";
const README_PATTERN = /^readme(\.[a-z0-9]+)?$/i;

export interface AssembleInput {
  output: WriteOutput;
  analysisId: string;
  level: Level;
  purpose: Purpose;
  repo: { owner: string; name: string; ref: string; commitSha: string; htmlUrl: string };
  /** 작업 집합 중 원문이 있는 파일: 경로 → 줄 수 */
  sources: ReadonlyMap<string, number>;
  /** 코드가 판정한 한계 문구(고정 문구). LLM 문구보다 앞에 둔다. */
  codeLimitations: string[];
  model: string;
  promptVersion: string;
  generatedAt: Date;
}

export interface AssembleResult {
  manual: Manual;
  stats: ManualStats;
}

const nonEmpty = (value: string | undefined) => (value && value.trim().length > 0 ? value : undefined);

export function assembleManual(input: AssembleInput): AssembleResult {
  const { repo, output } = input;
  const stats: ManualStats = {
    blocks: 0,
    facts: 0,
    inferences: 0,
    evidenceKept: 0,
    evidenceDropped: 0,
    downgraded: 0,
    sectionsNotFound: 0,
    stepWarnings: 0,
  };

  const sections: ManualSection[] = SECTION_CATALOG[input.purpose].map((definition) => {
    const written = output.sections.find((section) => section.sectionId === definition.id);
    const blocks: ManualBlock[] = [];
    for (const raw of written?.blocks ?? []) {
      if (!nonEmpty(raw.markdown) && !nonEmpty(raw.command)) continue;
      const { kept, dropped } = validateEvidence(raw.evidence, input.sources);
      const downgraded = raw.kind === "fact" && kept.length === 0;
      const block: ManualBlock = {
        id: `${definition.id}.${blocks.length + 1}`,
        type: raw.type,
        markdown: raw.markdown,
        kind: downgraded ? "inference" : raw.kind,
        downgraded,
        evidence: kept.map((item) => ({
          ...item,
          url: lineUrl(repo.owner, repo.name, repo.commitSha, item.path, item.startLine, item.endLine),
        })),
        ...(raw.type === "step" && raw.stepNo !== undefined ? { stepNo: raw.stepNo } : {}),
        ...(nonEmpty(raw.command) ? { command: raw.command } : {}),
        ...(nonEmpty(raw.expectedResult) ? { expectedResult: raw.expectedResult } : {}),
        ...(nonEmpty(raw.troubleshooting) ? { troubleshooting: raw.troubleshooting } : {}),
      };
      blocks.push(block);
      stats.evidenceKept += kept.length;
      stats.evidenceDropped += dropped;
      if (downgraded) stats.downgraded += 1;
      if (block.kind === "fact") stats.facts += 1;
      else stats.inferences += 1;
      if (input.level === "beginner" && block.type === "step" && (!block.expectedResult || !block.troubleshooting)) {
        stats.stepWarnings += 1;
      }
    }
    stats.blocks += blocks.length;
    const status = blocks.length === 0 ? "not_found" : written?.status === "not_found" ? "partial" : (written?.status ?? "partial");
    if (status === "not_found") stats.sectionsNotFound += 1;
    return { id: definition.id, title: definition.title, status, blocks };
  });

  const workingPaths = [...input.sources.keys()];
  const readmeOnly = !workingPaths.some((path) => !README_PATTERN.test(path.slice(path.lastIndexOf("/") + 1)));
  const llmLimitations = output.limitations.map((line) => line.trim()).filter(Boolean);
  const limitations = [...new Set([...(readmeOnly ? [README_ONLY_LIMITATION] : []), ...input.codeLimitations, ...llmLimitations])];

  const manual: Manual = {
    analysisId: input.analysisId,
    language: "ko",
    level: input.level,
    purpose: input.purpose,
    repo,
    title: nonEmpty(output.title) ?? `${repo.owner}/${repo.name} 매뉴얼`,
    overview: output.overview,
    sections,
    levelExtras: levelExtrasFor(input, workingPaths),
    limitations,
    generatedAt: input.generatedAt.toISOString(),
    model: input.model,
    promptVersion: input.promptVersion,
  };
  return { manual: ManualSchema.parse(manual), stats };
}

function levelExtrasFor(input: AssembleInput, workingPaths: string[]): LevelExtras {
  const extras = input.output.levelExtras;
  switch (input.level) {
    case "beginner":
      return {
        level: "beginner",
        glossary: extras.glossary.filter((item) => nonEmpty(item.term) && nonEmpty(item.explanation)),
        prerequisites: extras.prerequisites.filter((item) => nonEmpty(item.topic) && nonEmpty(item.explanation)),
      };
    case "vibe_coder": {
      const known = new Set(workingPaths);
      return {
        level: "vibe_coder",
        contextSummary: extras.contextSummary,
        relatedFiles: extras.relatedFiles
          .map((item) => ({ ...item, path: normalizePath(item.path) }))
          .filter((item) => known.has(item.path))
          .map((item) => ({ ...item, url: blobUrl(input.repo.owner, input.repo.name, input.repo.commitSha, item.path) })),
        promptExamples: extras.promptExamples.filter((item) => nonEmpty(item.prompt)),
        checklist: extras.checklist.filter((item) => nonEmpty(item)),
      };
    }
    case "developer":
      return { level: "developer" };
  }
}
