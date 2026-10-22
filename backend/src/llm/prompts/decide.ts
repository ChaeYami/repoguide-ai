import type { DetectedStack, Level, Purpose } from "@repoguide/shared";
import type { FileNote } from "../../db/json-types.js";
import { repoContextText, type RepoContext, sectionCatalogText, userContextText } from "./context.js";
import { type FileForPrompt, formatFileBlock, UNTRUSTED_DATA_RULES } from "./file-block.js";

// Decide: 다음에 읽을 파일과 정보 충분성을 판단한다 (contracts/llm-io.md §1).

export interface DecidePromptInput {
  repo: RepoContext;
  stack: DetectedStack;
  level: Level;
  purpose: Purpose;
  decideNo: number;
  treeListing: string;
  collapsedDirectories: string[];
  alreadyRead: string[];
  notes: FileNote[];
  newFiles: FileForPrompt[];
  remaining: { rounds: number; files: number; perRound: number };
}

const SYSTEM = [
  "너는 GitHub 저장소를 분석해 사용자 맞춤 매뉴얼에 필요한 정보를 모으는 탐색 담당이다.",
  "주어진 파일 목록과 원문을 보고, 필수 섹션을 근거와 함께 쓰기에 정보가 충분한지 판단하고, 부족하면 다음에 읽을 파일을 고른다.",
  "",
  "규칙:",
  UNTRUSTED_DATA_RULES,
  "- requests의 path는 '파일 목록'에 나온 파일 경로만 쓴다. 디렉터리는 요청하지 않는다.",
  "- 접힌 디렉터리('dir/ (N files)') 안을 보고 싶으면 expandDirectories에 그 디렉터리 경로를 넣는다(최대 5개).",
  "- requests는 '남은 예산'의 이번 라운드 최대 개수를 넘기지 않는다. 필수 섹션 중 부족한 것에 꼭 필요한 파일부터 고른다.",
  "- 이번에 원문으로 받은 파일마다 fileNotes를 1개씩 쓴다. summary는 400자 이내, facts는 8개 이내이며 각 fact에 정확한 라인 범위를 단다.",
  "- coverage에는 필수 섹션마다 covered/partial/missing과 짧은 근거 메모를 쓴다.",
  "- 모든 필수 섹션을 파일 근거로 쓸 수 있을 때만 sufficient를 true로 한다. 저장소에 정보 자체가 없는 섹션은 missing으로 두고 충분성 판단에서 제외한다.",
].join("\n");

export function buildDecidePrompt(input: DecidePromptInput): { systemInstruction: string; input: string } {
  const notes = input.notes.length
    ? input.notes.map((note) => `- ${note.path}: ${note.summary}`).join("\n")
    : "(없음)";
  const body = [
    `# 탐색 판단 #${input.decideNo}`,
    "## 저장소",
    repoContextText(input.repo, input.stack),
    "## 사용자",
    userContextText(input.level, input.purpose),
    "## 필수 섹션 (coverage의 sectionId로 사용)",
    sectionCatalogText(input.purpose),
    "## 남은 예산",
    `- 남은 읽기 라운드: ${input.remaining.rounds}`,
    `- 더 읽을 수 있는 파일 수: ${input.remaining.files}`,
    `- 이번 라운드 최대 요청 수: ${Math.min(input.remaining.perRound, input.remaining.files)}`,
    "## 파일 목록",
    input.treeListing || "(비어 있음)",
    input.collapsedDirectories.length ? `접힌 디렉터리: ${input.collapsedDirectories.slice(0, 200).join(", ")}` : "",
    "## 이미 읽었거나 읽기로 한 파일 (다시 요청하지 않는다)",
    input.alreadyRead.length ? input.alreadyRead.map((path) => `- ${path}`).join("\n") : "(없음)",
    input.decideNo === 1 && input.alreadyRead.length > 0
      ? "위 파일(README·매니페스트 등 시드)은 이미 읽었고, 다음 판단에서 원문을 함께 보여 준다. 이번에는 그 외에 필요한 파일(진입점, 핵심 소스, 설정, 문서, 테스트 등)을 파일 목록에서 고른다."
      : "",
    "## 이전 라운드 파일 노트",
    notes,
    "## 이번에 새로 읽은 파일 원문",
    input.newFiles.length ? input.newFiles.map(formatFileBlock).join("\n\n") : "(없음 — 파일 목록을 보고 읽을 파일을 고른다)",
  ]
    .filter((part) => part !== "")
    .join("\n\n");
  return { systemInstruction: SYSTEM, input: body };
}
