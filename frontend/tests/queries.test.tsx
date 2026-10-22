import { AnalysisDetailSchema } from "@repoguide/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiRequest, ApiRequestError } from "../src/api/client";
import { POLL_INTERVAL_MS, pollInterval, shouldRetry } from "../src/api/queries";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Response | Error) {
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }));
}

describe("polling rules", () => {
  it("polls every 2 seconds only while queued or running", () => {
    expect(pollInterval("queued")).toBe(POLL_INTERVAL_MS);
    expect(pollInterval("running")).toBe(2_000);
    for (const status of ["completed", "partial", "failed", "expired"] as const) expect(pollInterval(status)).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });

  it("does not retry 404 or 410", () => {
    expect(shouldRetry(0, new ApiRequestError(404, { code: "not_found", message: "x" }))).toBe(false);
    expect(shouldRetry(0, new ApiRequestError(410, { code: "expired", message: "x" }))).toBe(false);
    expect(shouldRetry(0, new ApiRequestError(500, { code: "internal_error", message: "x" }))).toBe(true);
    expect(shouldRetry(2, new Error("x"))).toBe(false);
  });
});

describe("apiRequest", () => {
  it("parses the server's error response into a user-facing error", async () => {
    stubFetch(new Response(JSON.stringify({ error: { code: "invalid_url", message: "GitHub 저장소 주소만 지원합니다.", action: "예: https://github.com/owner/repo" } }), { status: 400 }));
    const error = await apiRequest("/api/analyses", AnalysisDetailSchema).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(400);
    expect((error as ApiRequestError).body).toMatchObject({ code: "invalid_url", action: "예: https://github.com/owner/repo" });
  });

  it("explains network failures", async () => {
    stubFetch(new TypeError("Failed to fetch"));
    const error = (await apiRequest("/api/x", AnalysisDetailSchema).catch((e: unknown) => e)) as ApiRequestError;
    expect(error.status).toBe(0);
    expect(error.message).toBe("서버에 연결할 수 없습니다.");
  });

  it("falls back to a generic message for non-JSON errors", async () => {
    stubFetch(new Response("<html>bad gateway</html>", { status: 502 }));
    const error = (await apiRequest("/api/x", AnalysisDetailSchema).catch((e: unknown) => e)) as ApiRequestError;
    expect(error.message).toBe("알 수 없는 오류가 발생했습니다.");
  });
});
