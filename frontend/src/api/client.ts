import {
  type AnalysisDetail,
  AnalysisDetailSchema,
  type CreateAnalysisRequest,
  type CreateAnalysisResponse,
  CreateAnalysisResponseSchema,
  type ErrorResponse,
  ErrorResponseSchema,
  type Manual,
  ManualSchema,
} from "@repoguide/shared";

// 백엔드 API 호출. 응답은 shared 계약 스키마로 검증하고, 오류는 사용자 문구(ErrorResponse)로 바꾼다.

export type ApiErrorBody = ErrorResponse["error"];

export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiErrorBody,
  ) {
    super(body.message);
    this.name = "ApiRequestError";
  }
}

const NETWORK_ERROR: ApiErrorBody = {
  code: "internal_error",
  message: "서버에 연결할 수 없습니다.",
  action: "네트워크 상태를 확인하고 다시 시도해 주세요.",
};

const UNKNOWN_ERROR: ApiErrorBody = { code: "internal_error", message: "알 수 없는 오류가 발생했습니다." };

export async function apiRequest<T>(path: string, schema: { parse(data: unknown): T }, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}) },
    });
  } catch {
    throw new ApiRequestError(0, NETWORK_ERROR);
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = ErrorResponseSchema.safeParse(body);
    throw new ApiRequestError(response.status, parsed.success ? parsed.data.error : UNKNOWN_ERROR);
  }
  return schema.parse(body);
}

export const api = {
  createAnalysis: (request: CreateAnalysisRequest): Promise<CreateAnalysisResponse> =>
    apiRequest("/api/analyses", CreateAnalysisResponseSchema, { method: "POST", body: JSON.stringify(request) }),
  getAnalysis: (id: string): Promise<AnalysisDetail> =>
    apiRequest(`/api/analyses/${encodeURIComponent(id)}`, AnalysisDetailSchema),
  getManual: (id: string): Promise<Manual> =>
    apiRequest(`/api/analyses/${encodeURIComponent(id)}/manual`, ManualSchema),
};
