import type { DetectedStack, Level, Purpose } from "@repoguide/shared";
import type { CoverageEntry, FileNote } from "../../db/json-types.js";
import { repoContextText, type RepoContext, sectionCatalogText, userContextText } from "./context.js";
import { type FileForPrompt, formatFileBlock, UNTRUSTED_DATA_RULES } from "./file-block.js";
import { LEVEL_GUIDES } from "./level-guides.js";

// Write: 수준·목적에 맞는 매뉴얼을 작성한다 (contracts/llm-io.md §2, FR-020~FR-023).

export interface WritePromptInput {
  repo: RepoContext;
  stack: DetectedStack;
  level: Level;
  purpose: Purpose;
  files: FileForPrompt[];
  noteOnlyFiles: FileNote[];
  coverage: CoverageEntry[];
  limitations: string[];
}

function systemInstruction(level: Level): string {
  return [
    "너는 GitHub 저장소의 실제 파일을 근거로 사용자 맞춤 매뉴얼을 쓰는 기술 문서 작성자다.",
    "",
    "규칙:",
    UNTRUSTED_DATA_RULES,
    "- 매뉴얼은 한국어로 쓴다. 코드, 명령어, 파일 경로, 설정 키는 원문 그대로 둔다.",
    "- sections에는 '필수 섹션'의 sectionId만, 주어진 순서대로 모두 넣는다.",
    "- 블록이 FILE 블록 내용으로 직접 확인되면 kind \"fact\"로 하고 evidence에 경로와 정확한 라인 범위를 1개 이상 단다.",
    "- 파일에서 직접 확인되지 않고 근거로부터 추정한 내용은 kind \"inference\"로 한다. 확인되지 않은 내용을 fact로 쓰지 않는다.",
    "- 저장소에서 정보를 찾을 수 없는 섹션은 status \"not_found\", blocks는 빈 배열로 둔다. 일반 관행으로 안내를 덧붙이려면 inference 블록으로 쓰고 status는 \"partial\"로 한다.",
    "- evidence의 path는 FILE 블록의 path만 쓴다. 노트만 있는 파일은 근거로 쓰지 않는다.",
    "- limitations에는 분석 범위의 한계를 짧게 쓴다(없으면 빈 배열).",
    "",
    "사용자 수준별 작성 방식:",
    LEVEL_GUIDES[level],
  ].join("\n");
}

export function buildWritePrompt(input: WritePromptInput): { systemInstruction: string; input: string } {
  const coverage = input.coverage.length
    ? input.coverage.map((entry) => `- ${entry.sectionId}: ${entry.status} — ${entry.note}`).join("\n")
    : "(탐색 판단 없음)";
  const notes = input.noteOnlyFiles.length
    ? input.noteOnlyFiles
        .map((note) => [`- ${note.path}: ${note.summary}`, ...note.facts.map((fact) => `  - ${fact.text}`)].join("\n"))
        .join("\n")
    : "(없음)";
  const body = [
    "# 매뉴얼 작성",
    "## 저장소",
    repoContextText(input.repo, input.stack),
    "## 사용자",
    userContextText(input.level, input.purpose),
    "## 필수 섹션 (이 순서대로 모두)",
    sectionCatalogText(input.purpose),
    "## 탐색 단계의 섹션 커버리지",
    coverage,
    "## 코드가 판정한 분석 한계",
    input.limitations.length ? input.limitations.map((line) => `- ${line}`).join("\n") : "(없음)",
    "## 원문 없이 노트만 전달되는 파일 (근거로 인용 불가)",
    notes,
    "## 파일 원문",
    input.files.map(formatFileBlock).join("\n\n") || "(없음)",
  ].join("\n\n");
  return { systemInstruction: systemInstruction(input.level), input: body };
}
