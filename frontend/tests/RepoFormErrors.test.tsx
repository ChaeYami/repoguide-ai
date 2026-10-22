import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepoForm } from "../src/components/RepoForm";
import { renderWithProviders } from "./render";

afterEach(() => vi.unstubAllGlobals());

async function submitWith(status: number, error: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error }), { status })));
  const user = userEvent.setup();
  renderWithProviders(<RepoForm />);
  await user.type(screen.getByLabelText("GitHub 저장소 URL"), "https://github.com/acme/demo");
  await user.click(screen.getByLabelText(/입문자/));
  await user.click(screen.getByLabelText(/설치 및 실행/));
  await user.click(screen.getByRole("button", { name: "분석 시작" }));
  return screen.findByRole("alert");
}

describe("RepoForm request errors", () => {
  it("shows the per-client rate limit with when to try again (429)", async () => {
    const alert = await submitWith(429, { code: "rate_limited", message: "오늘 분석 요청 한도(24시간에 10회)에 도달했습니다.", action: "안내된 시간이 지난 뒤 다시 시도해 주세요.", retryAfterSec: 3600 });
    expect(alert).toHaveTextContent("분석을 시작하지 못했습니다");
    expect(alert).toHaveTextContent("24시간에 10회");
    expect(alert).toHaveTextContent(/이후\(약 1시간 후\) 다시 시도할 수 있습니다/);
  });

  it("shows the daily budget refusal (503)", async () => {
    const alert = await submitWith(503, { code: "daily_budget_exhausted", message: "오늘 서비스 사용량 한도에 도달해 새 분석을 받을 수 없습니다.", action: "한국 시간 자정 이후 다시 시도해 주세요.", retryAfterSec: 7200 });
    expect(alert).toHaveTextContent("한국 시간 자정 이후 다시 시도해 주세요.");
    expect(alert).toHaveTextContent(/약 2시간 후/);
  });

  it("shows the server's URL rejection (400)", async () => {
    const alert = await submitWith(400, { code: "invalid_url", message: "GitHub 저장소 주소만 지원합니다.", action: "예: https://github.com/owner/repo" });
    expect(alert).toHaveTextContent("GitHub 저장소 주소만 지원합니다.");
    expect(alert).not.toHaveTextContent("다시 시도할 수 있습니다");
  });
});
