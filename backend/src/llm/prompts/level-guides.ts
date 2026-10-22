import type { Level } from "@repoguide/shared";

// 수준별 설명 방식 (FR-021). 용어·깊이·예시·선행 지식·작업 절차를 수준마다 다르게 지시한다.

export const LEVEL_LABELS: Record<Level, string> = {
  beginner: "입문자 (프로그래밍·개발 환경 사전 지식이 거의 없음)",
  vibe_coder: "바이브 코딩 개발자 (AI 코딩 도구로 프로젝트를 이해하거나 수정하려 함)",
  developer: "일반 개발자 (소스 코드·기술 스택·아키텍처를 이해하고 직접 개발함)",
};

export const LEVEL_GUIDES: Record<Level, string> = {
  beginner: [
    "- 전문 용어를 최소화하고, 처음 등장하는 용어는 levelExtras.glossary에 쉬운 말로 풀이한다.",
    "- 필요한 선행 지식(터미널 사용법, Git으로 저장소 받기, 패키지 설치 등)을 levelExtras.prerequisites에 설명한다.",
    "- 작업은 type \"step\" 블록으로 하나씩 따라 할 수 있게 쓰고 stepNo를 1부터 매긴다.",
    "- 모든 step 블록에 expectedResult(정상일 때 보이는 결과)와 troubleshooting(흔한 실패와 대처)를 채운다.",
    "- 실행할 명령은 command 필드에 원문 그대로 넣는다.",
    "- levelExtras의 contextSummary는 빈 문자열, relatedFiles·promptExamples·checklist는 빈 배열로 둔다.",
  ].join("\n"),
  vibe_coder: [
    "- 본문은 간결하게, 파일 경로와 역할 중심으로 쓴다.",
    "- levelExtras.contextSummary에 AI 코딩 도구에 그대로 붙여 넣을 프로젝트 맥락 요약(5~10문장)을 쓴다.",
    "- levelExtras.relatedFiles에 작업과 관련된 파일 경로와 이유를 나열한다. 경로는 FILE 블록이나 파일 목록에 있는 것만 쓴다.",
    "- levelExtras.promptExamples에 AI 도구에 줄 수 있는 구체적인 요청 예시를 3개 이상 쓴다.",
    "- levelExtras.checklist에 변경 후 확인할 검증 항목(실행, 테스트, 확인할 화면 등)을 쓴다.",
    "- levelExtras의 glossary·prerequisites는 빈 배열로 둔다.",
  ].join("\n"),
  developer: [
    "- 기초 개념 설명은 생략한다.",
    "- 기술 스택, 아키텍처, 모듈 간 관계, 진입점, 데이터 흐름을 간결하지만 구체적으로 쓴다.",
    "- 파일·함수·설정 키 이름을 정확히 언급한다.",
    "- levelExtras의 문자열은 빈 문자열, 배열은 모두 빈 배열로 둔다.",
  ].join("\n"),
};
