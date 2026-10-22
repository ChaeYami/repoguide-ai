import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FailureNotice } from "../src/components/FailureNotice";
import { formatRetryAfter } from "../src/lib/labels";

describe("formatRetryAfter", () => {
  it.each([
    [600, "2026-10-22T03:00:00Z", "10월 22일 오후 12:10 이후(약 10분 후) 다시 시도할 수 있습니다."],
    [12 * 3600, "2026-10-22T03:00:00Z", "10월 23일 오전 12:00 이후(약 12시간 후) 다시 시도할 수 있습니다."],
  ])("shows %i seconds from %s in Korean time", (seconds, now, expected) => {
    expect(formatRetryAfter(seconds, new Date(now))).toBe(expected);
  });
});

describe("FailureNotice", () => {
  beforeEach(() => vi.useFakeTimers({ now: new Date("2026-10-22T03:00:00Z"), toFake: ["Date"] }));
  afterEach(() => vi.useRealTimers());

  it("shows the fixed message and the action", () => {
    render(<FailureNotice message="저장소를 찾을 수 없거나 비공개 저장소입니다. 공개 저장소만 지원합니다." action="URL이 맞는지 확인해 주세요." retryAfterSec={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("분석을 완료하지 못했습니다");
    expect(screen.getByText("URL이 맞는지 확인해 주세요.")).toBeInTheDocument();
    expect(screen.queryByText(/다시 시도할 수 있습니다/)).toBeNull();
  });

  it("shows when the user can try again for rate-limited failures", () => {
    render(<FailureNotice message="GitHub 사용량 제한에 걸렸습니다." action="안내된 시간이 지난 뒤 다시 시도해 주세요." retryAfterSec={300} />);
    expect(screen.getByText("10월 22일 오후 12:05 이후(약 5분 후) 다시 시도할 수 있습니다.")).toBeInTheDocument();
  });
});
