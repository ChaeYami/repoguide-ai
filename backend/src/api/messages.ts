import type { FailureCode, PartialReason } from "@repoguide/shared";

// 사용자에게 보여 주는 고정 문구 (FR-028, FR-029, contracts/http-api.md "사용자 메시지 매핑").
// LLM이 만들지 않으며, 내부 오류 상세를 담지 않는다.

export const FAILURE_MESSAGES: Record<FailureCode, { message: string; action: string }> = {
  invalid_url: {
    message: "GitHub 저장소 주소 형식이 아닙니다.",
    action: "https://github.com/owner/repo 형식으로 입력해 주세요.",
  },
  repo_not_found_or_private: {
    message: "저장소를 찾을 수 없거나 비공개 저장소입니다. 공개 저장소만 지원합니다.",
    action: "URL이 맞는지, 저장소가 공개 상태인지 확인해 주세요.",
  },
  repo_empty: {
    message: "저장소에 커밋이 없습니다.",
    action: "내용이 있는 다른 저장소로 시도해 주세요.",
  },
  ref_not_found: {
    message: "URL의 브랜치나 태그를 찾을 수 없습니다.",
    action: "기본 브랜치 주소(https://github.com/owner/repo)로 다시 시도해 주세요.",
  },
  no_analyzable_files: {
    message: "분석할 수 있는 텍스트 파일이 없습니다.",
    action: "소스 코드나 문서가 들어 있는 저장소로 시도해 주세요.",
  },
  limit_reached: {
    message: "분석 한도 안에서 매뉴얼을 만들 수 없었습니다.",
    action: "하위 경로가 포함된 URL(…/tree/브랜치/경로)로 범위를 좁혀 다시 시도해 주세요.",
  },
  github_rate_limited: {
    message: "GitHub 사용량 제한에 걸렸습니다.",
    action: "안내된 시간이 지난 뒤 다시 시도해 주세요.",
  },
  github_unavailable: {
    message: "GitHub가 일시적으로 응답하지 않습니다.",
    action: "잠시 후 다시 시도해 주세요.",
  },
  llm_rate_limited: {
    message: "AI 서비스 사용량 제한에 걸렸습니다.",
    action: "잠시 후 다시 시도해 주세요.",
  },
  llm_unavailable: {
    message: "AI 서비스가 일시적으로 응답하지 않습니다.",
    action: "잠시 후 다시 시도해 주세요.",
  },
  manual_generation_failed: {
    message: "매뉴얼 생성 결과가 올바르지 않아 완성하지 못했습니다.",
    action: "다시 시도해 주세요.",
  },
  timeout: {
    message: "분석 시간이 상한을 넘었습니다.",
    action: "하위 경로가 포함된 URL로 범위를 좁혀 다시 시도해 주세요.",
  },
  internal_error: {
    message: "알 수 없는 오류가 발생했습니다.",
    action: "잠시 후 다시 시도해 주세요.",
  },
};

export const PARTIAL_MESSAGES: Record<PartialReason, string> = {
  round_limit: "탐색 라운드 한도에 도달해 일부 섹션은 확보한 정보로만 작성했습니다.",
  file_limit: "읽을 수 있는 파일 수 한도에 도달해 일부 파일은 분석하지 못했습니다.",
  cost_limit: "분석 비용 한도에 도달해 추가 탐색을 멈췄습니다.",
  token_limit: "AI 처리량 한도에 도달해 추가 탐색을 멈췄습니다.",
  github_call_limit: "GitHub 호출 한도에 도달해 일부 파일은 분석하지 못했습니다.",
  timeout: "분석 시간 한도에 도달해 확보한 정보로만 작성했습니다.",
  repo_too_large: "저장소가 커서 일부 디렉터리만 분석했습니다.",
  content_trimmed: "분석량 한도 때문에 일부 파일은 원문 대신 요약만 반영했습니다.",
};
