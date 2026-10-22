import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FreshnessBanner } from "../src/components/FreshnessBanner";
import { RegeneratePanel } from "../src/components/RegeneratePanel";
import { VersionSwitcher } from "../src/components/VersionSwitcher";
import { detail, ID, SHA } from "./fixtures";

// 재생성 화면 (T045, FR-032, FR-033)

describe("RegeneratePanel", () => {
  it("is disabled until level or purpose changes, then requests change_options", async () => {
    const onRegenerate = vi.fn();
    const user = userEvent.setup();
    render(<RegeneratePanel level="beginner" purpose="setup" pending={false} error={null} onRegenerate={onRegenerate} />);
    const button = screen.getByRole("button", { name: "수준이나 목적을 바꿔 주세요" });
    expect(button).toBeDisabled();
    await user.click(screen.getByLabelText(/일반 개발자/));
    await user.click(screen.getByRole("button", { name: "이 조건으로 다시 만들기" }));
    expect(onRegenerate).toHaveBeenCalledWith({ mode: "change_options", level: "developer", purpose: "setup" });
    await user.click(screen.getByLabelText(/입문자/));
    expect(screen.getByRole("button", { name: "수준이나 목적을 바꿔 주세요" })).toBeDisabled();
  });

  it("shows request errors in the failure notice format", () => {
    render(
      <RegeneratePanel
        level="beginner"
        purpose="setup"
        pending={false}
        error={{ message: "오늘 분석 요청 한도(24시간에 10회)에 도달했습니다.", action: "안내된 시간이 지난 뒤 다시 시도해 주세요.", retryAfterSec: 600 }}
        onRegenerate={() => {}}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("다시 만들지 못했습니다");
    expect(alert).toHaveTextContent("24시간에 10회");
    expect(alert).toHaveTextContent(/약 10분 후/);
  });
});

describe("FreshnessBanner", () => {
  const freshness = { analyzedCommitSha: SHA, latestCommitSha: "f".repeat(40), isOutdated: true, checkedAt: new Date().toISOString() };

  it("offers to re-analyze when a newer commit exists", async () => {
    const onRefresh = vi.fn();
    render(<FreshnessBanner freshness={freshness} pending={false} onRefresh={onRefresh} />);
    expect(screen.getByRole("status")).toHaveTextContent(`${SHA.slice(0, 7)} → fffffff`);
    await userEvent.setup().click(screen.getByRole("button", { name: "최신 커밋으로 다시 분석" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("renders nothing when the analysis is up to date", () => {
    const { container } = render(<FreshnessBanner freshness={{ ...freshness, isOutdated: false }} pending={false} onRefresh={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("VersionSwitcher", () => {
  const current = detail();
  const versions = [
    { ...current, id: ID, level: "beginner" as const, purpose: "setup" as const, status: "completed" as const },
    { ...current, id: "44444444-4444-4444-8444-444444444444", level: "developer" as const, purpose: "modify" as const, status: "running" as const },
  ];

  it("lists versions in order, marks the current one and links to the others", () => {
    render(
      <MemoryRouter>
        <VersionSwitcher versions={versions} currentId={ID} />
      </MemoryRouter>,
    );
    const nav = screen.getByRole("navigation", { name: "버전" });
    expect(within(nav).getByText("버전 2개")).toBeInTheDocument();
    expect(within(nav).getByText("v1 · 입문자 · 설치 및 실행 (지금 보는 버전)")).toHaveAttribute("aria-current", "page");
    expect(within(nav).getByRole("link", { name: "v2 · 일반 개발자 · 코드 수정 및 확장" })).toHaveAttribute("href", `/a/${versions[1]!.id}`);
    expect(within(nav).getAllByText(new RegExp(SHA.slice(0, 7))).length).toBe(2);
  });

  it("is hidden when there is only one version", () => {
    const { container } = render(
      <MemoryRouter>
        <VersionSwitcher versions={versions.slice(0, 1)} currentId={ID} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
