import type { DetectedStack, Level, Purpose } from "@repoguide/shared";
import { SECTION_CATALOG } from "@repoguide/shared";
import { LEVEL_LABELS } from "./level-guides.js";

// Decide·Write 프롬프트가 공유하는 저장소·사용자 맥락.

export interface RepoContext {
  owner: string;
  name: string;
  description: string | null;
  language: string | null;
  ref: string;
  commitSha: string;
  subpath: string | null;
}

export const PURPOSE_LABELS: Record<Purpose, string> = {
  understand: "프로젝트 이해",
  setup: "설치 및 실행",
  modify: "코드 수정 및 확장",
};

export function repoContextText(repo: RepoContext, stack: DetectedStack): string {
  return [
    `- 저장소: ${repo.owner}/${repo.name} (ref ${repo.ref}, 커밋 ${repo.commitSha})`,
    `- 설명: ${repo.description ?? "(없음)"}`,
    `- 주 언어: ${repo.language ?? "(알 수 없음)"}`,
    `- 우선 탐색 경로: ${repo.subpath ?? "(전체 저장소)"}`,
    `- 감지된 스택: 언어 ${stack.languages.join(", ") || "-"} / 패키지 관리 ${stack.packageManagers.join(", ") || "-"} / 프레임워크 힌트 ${stack.frameworkHints.join(", ") || "-"}`,
  ].join("\n");
}

export function userContextText(level: Level, purpose: Purpose): string {
  return [`- 사용자 수준: ${LEVEL_LABELS[level]}`, `- 매뉴얼 목적: ${PURPOSE_LABELS[purpose]}`].join("\n");
}

export function sectionCatalogText(purpose: Purpose): string {
  return SECTION_CATALOG[purpose].map((section) => `- ${section.id} (${section.title}): ${section.guidance}`).join("\n");
}
