import type { ErrorCode, ErrorResponse } from "@repoguide/shared";

// API 오류 응답. 메시지는 사용자에게 그대로 보여줄 수 있는 한국어 고정 문구이며 내부 상세를 담지 않는다(FR-029).

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly extra: { action?: string; retryAfterSec?: number } = {},
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorBody(
  code: ErrorCode,
  message: string,
  extra: { action?: string; retryAfterSec?: number } = {},
): ErrorResponse {
  return { error: { code, message, ...extra } };
}

export const COMMON_ERRORS = {
  invalidRequest: () => errorBody("invalid_request", "요청 형식이 올바르지 않습니다."),
  notFound: () => errorBody("not_found", "요청한 리소스를 찾을 수 없습니다."),
  internal: () =>
    errorBody("internal_error", "알 수 없는 오류가 발생했습니다.", {
      action: "잠시 후 다시 시도해 주세요.",
    }),
};
