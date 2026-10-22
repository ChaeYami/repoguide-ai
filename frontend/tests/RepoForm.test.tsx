import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RepoForm } from "../src/components/RepoForm";
import { renderWithProviders } from "./render";

afterEach(() => vi.unstubAllGlobals());

const ID = "11111111-1111-4111-8111-111111111111";

describe("RepoForm", () => {
  it("shows the format example for an invalid URL (FR-002)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RepoForm />);
    await user.type(screen.getByLabelText("GitHub 저장소 URL"), "https://gitlab.com/a/b");
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("GitHub 저장소 주소만 지원합니다. 예: https://github.com/owner/repo");
  });

  it("enables the start button only when URL, level and purpose are all set (FR-005)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RepoForm />);
    const start = screen.getByRole("button", { name: "분석 시작" });
    expect(start).toBeDisabled();
    await user.type(screen.getByLabelText("GitHub 저장소 URL"), "https://github.com/acme/demo");
    expect(start).toBeDisabled();
    await user.click(screen.getByLabelText(/입문자/));
    expect(start).toBeDisabled();
    await user.click(screen.getByLabelText(/설치 및 실행/));
    expect(start).toBeEnabled();
  });

  it("offers each level with a one-line description (FR-003) and only one purpose at a time (FR-004)", async () => {
    const user = userEvent.setup();
    renderWithProviders(<RepoForm />);
    expect(screen.getByText("프로그래밍·개발 환경이 처음이에요")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/프로젝트 이해/));
    await user.click(screen.getByLabelText(/코드 수정 및 확장/));
    expect(screen.getByLabelText(/프로젝트 이해/)).not.toBeChecked();
    expect(screen.getByLabelText(/코드 수정 및 확장/)).toBeChecked();
  });

  it("submits and navigates to the analysis page", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: ID, status: "queued", deduplicated: false }), { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithProviders(<RepoForm />);
    await user.type(screen.getByLabelText("GitHub 저장소 URL"), "github.com/acme/demo");
    await user.click(screen.getByLabelText(/일반 개발자/));
    await user.click(screen.getByLabelText(/프로젝트 이해/));
    await user.click(screen.getByRole("button", { name: "분석 시작" }));
    await waitFor(() => expect(screen.getByText("분석 페이지로 이동함")).toBeInTheDocument());
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body))).toEqual({
      repoUrl: "github.com/acme/demo",
      level: "developer",
      purpose: "understand",
    });
  });

  it("shows the server's message and action when the request is rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: { code: "rate_limited", message: "오늘 요청 한도에 도달했습니다.", action: "내일 다시 시도해 주세요." } }), { status: 429 })));
    const user = userEvent.setup();
    renderWithProviders(<RepoForm />);
    await user.type(screen.getByLabelText("GitHub 저장소 URL"), "https://github.com/acme/demo");
    await user.click(screen.getByLabelText(/입문자/));
    await user.click(screen.getByLabelText(/설치 및 실행/));
    await user.click(screen.getByRole("button", { name: "분석 시작" }));
    expect(await screen.findByText("오늘 요청 한도에 도달했습니다.")).toBeInTheDocument();
    expect(screen.getByText("내일 다시 시도해 주세요.")).toBeInTheDocument();
  });
});
