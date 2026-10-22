import { z } from "zod";
import type { Purpose } from "./enums.js";

// 목적별 필수 섹션 카탈로그 (FR-020, contracts/manual.md). id와 제목은 코드 상수이며 LLM이 바꾸지 않는다.

export interface SectionDefinition {
  id: string;
  title: string;
  guidance: string;
}

export const SECTION_CATALOG = {
  understand: [
    { id: "role", title: "프로젝트의 역할", guidance: "프로젝트가 해결하는 문제와 대상 사용자를 설명한다" },
    { id: "core_features", title: "핵심 기능", guidance: "사용자가 쓸 수 있는 주요 기능을 나열하고 각 기능이 어디에 구현되어 있는지 연결한다" },
    { id: "components", title: "주요 구성 요소", guidance: "디렉터리·모듈·패키지 단위의 구성 요소와 각자의 책임을 설명한다" },
    { id: "architecture", title: "아키텍처", guidance: "구성 요소 간 관계, 기술 스택, 외부 서비스 연동 구조를 설명한다" },
    { id: "execution_flow", title: "실행 흐름", guidance: "진입점에서 시작해 주요 요청이나 작업이 처리되는 순서를 설명한다" },
  ],
  setup: [
    { id: "environment", title: "실행 환경", guidance: "필요한 운영체제, 런타임과 버전, 도구를 설명한다" },
    { id: "dependencies", title: "의존성", guidance: "의존성 선언 파일과 설치되는 주요 패키지를 설명한다" },
    { id: "install_steps", title: "설치 절차", guidance: "저장소를 받는 것부터 설치 완료까지 순서대로 안내한다" },
    { id: "configuration", title: "설정 파일", guidance: "환경 변수와 설정 파일, 각 값의 의미와 준비 방법을 설명한다" },
    { id: "run_commands", title: "실행 명령", guidance: "개발·운영 실행 명령과 각 명령이 하는 일을 설명한다" },
    { id: "verification", title: "정상 동작 확인", guidance: "실행 후 정상 동작을 확인하는 방법과 기대 결과를 설명한다" },
  ],
  modify: [
    { id: "entry_points", title: "주요 진입점", guidance: "실행이 시작되는 파일과 함수, 라우트 등록 지점을 설명한다" },
    { id: "related_files", title: "수정 관련 파일", guidance: "자주 수정하게 될 파일과 각 파일의 역할을 설명한다" },
    { id: "data_flow", title: "데이터 흐름", guidance: "입력이 처리되어 저장되거나 출력되기까지의 데이터 이동을 설명한다" },
    { id: "change_points", title: "변경 지점", guidance: "기능을 바꾸거나 추가할 때 손대야 하는 위치를 설명한다" },
    { id: "extension_directions", title: "확장 방향", guidance: "구조상 자연스러운 확장 방법과 주의할 점을 설명한다" },
    { id: "change_verification", title: "변경 검증 방법", guidance: "테스트·린트·빌드 등 변경 후 확인 방법을 설명한다" },
  ],
} as const satisfies Record<Purpose, readonly SectionDefinition[]>;

type Catalog = typeof SECTION_CATALOG;
export type SectionId = Catalog[Purpose][number]["id"];

export const SECTION_IDS = Object.values(SECTION_CATALOG).flatMap((sections) =>
  sections.map((section) => section.id),
) as [SectionId, ...SectionId[]];

export const SectionIdSchema = z.enum(SECTION_IDS);

export function sectionIdsFor(purpose: Purpose): SectionId[] {
  return SECTION_CATALOG[purpose].map((section) => section.id);
}
