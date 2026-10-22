import type {
  AnalysisStage,
  AnalysisStatus,
  CoverageStatus,
  FileSource,
  Level,
  ProgressActivity,
  Purpose,
  RequestRejectReason,
  StopReason,
} from "@repoguide/shared";

// 화면 문구 (한국어, FR-023).

export const LEVEL_OPTIONS: { value: Level; label: string; description: string }[] = [
  { value: "beginner", label: "입문자", description: "프로그래밍·개발 환경이 처음이에요" },
  { value: "vibe_coder", label: "바이브 코딩 개발자", description: "AI 코딩 도구로 이해하고 고치고 싶어요" },
  { value: "developer", label: "일반 개발자", description: "코드와 구조를 직접 보고 개발해요" },
];

export const PURPOSE_OPTIONS: { value: Purpose; label: string; description: string }[] = [
  { value: "understand", label: "프로젝트 이해", description: "무엇을 하는 프로젝트인지, 어떻게 구성됐는지" },
  { value: "setup", label: "설치 및 실행", description: "내 컴퓨터에서 설치하고 실행하는 방법" },
  { value: "modify", label: "코드 수정 및 확장", description: "어디를 고치고 어떻게 확장하는지" },
];

export const LEVEL_LABELS = Object.fromEntries(LEVEL_OPTIONS.map((o) => [o.value, o.label])) as Record<Level, string>;
export const PURPOSE_LABELS = Object.fromEntries(PURPOSE_OPTIONS.map((o) => [o.value, o.label])) as Record<Purpose, string>;

/** 진행 표시 단계 (FR-018). done은 종료 표시라 단계 목록에 넣지 않는다. */
export const STAGE_STEPS: { stage: Exclude<AnalysisStage, "done">; label: string }[] = [
  { stage: "queued", label: "대기" },
  { stage: "validating_repo", label: "저장소 확인" },
  { stage: "scanning_structure", label: "구조 파악" },
  { stage: "selecting_files", label: "파일 선택" },
  { stage: "reading_files", label: "파일 분석" },
  { stage: "exploring_more", label: "추가 탐색" },
  { stage: "writing_manual", label: "매뉴얼 작성" },
];

export const ACTIVITY_LABELS: Record<ProgressActivity, string> = {
  reading_files: "파일을 읽는 중",
  llm_deciding: "AI가 더 읽을 파일을 판단하는 중",
  llm_writing: "AI가 매뉴얼을 작성하는 중",
  llm_retry_wait: "AI 서비스 응답을 기다리는 중",
  validating_citations: "근거를 검증하는 중",
};

export const STATUS_LABELS: Record<AnalysisStatus, string> = {
  queued: "대기 중",
  running: "분석 중",
  completed: "완료",
  partial: "부분 완료",
  failed: "실패",
  expired: "만료",
};

// ── 분석 내역 (FR-027) ──

export const FILE_SOURCE_LABELS: Record<FileSource, string> = {
  seed: "시드",
  llm_request: "AI 요청",
  reused: "재사용",
};

export const REJECT_REASON_LABELS: Record<RequestRejectReason, string> = {
  not_in_tree: "저장소에 없는 파일",
  not_a_file: "디렉터리",
  excluded: "제외 대상",
  too_large: "크기 초과",
  already_read: "이미 읽음",
  over_round_limit: "라운드당 개수 초과",
  over_file_limit: "파일 수 한도 초과",
  budget: "호출 예산 부족",
};

export const COVERAGE_LABELS: Record<CoverageStatus, string> = {
  covered: "충분",
  partial: "일부",
  missing: "부족",
};

export const STOP_REASON_LABELS: Record<StopReason, string> = {
  sufficient: "정보가 충분하다고 판단",
  no_more_candidates: "더 읽을 파일 없음",
  round_limit: "탐색 라운드 한도 도달",
  file_limit: "파일 수 한도 도달",
  cost_limit: "비용 한도 도달",
  token_limit: "처리량 한도 도달",
  github_call_limit: "GitHub 호출 한도 도달",
  timeout: "시간 한도 도달",
};

const KST_TIME = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** 재시도 가능 시각을 한국 시간으로 안내한다. 예: "10월 23일 오전 12:00 이후(약 12시간 후) 다시 시도할 수 있습니다." */
export function formatRetryAfter(retryAfterSec: number, now: Date = new Date()): string {
  const at = new Date(now.getTime() + retryAfterSec * 1000);
  const minutes = Math.ceil(retryAfterSec / 60);
  const relative = minutes < 60 ? `약 ${minutes}분 후` : `약 ${Math.round(minutes / 60)}시간 후`;
  return `${KST_TIME.format(at)} 이후(${relative}) 다시 시도할 수 있습니다.`;
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes > 0 ? `${minutes}분 ${seconds}초` : `${seconds}초`;
}
