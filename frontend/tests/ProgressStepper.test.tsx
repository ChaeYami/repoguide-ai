import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ProgressStepper } from "../src/components/ProgressStepper";
import { detail } from "./fixtures";

describe("ProgressStepper", () => {
  it("highlights the current stage and shows activity, elapsed time and files read", () => {
    render(<ProgressStepper detail={detail({ createdAt: new Date(Date.now() - 75_000).toISOString() })} />);
    expect(screen.getByText("파일 분석")).toHaveAttribute("aria-current", "step");
    expect(screen.getByText(/AI가 더 읽을 파일을 판단하는 중 · 경과 1분 1[45]초/)).toBeInTheDocument();
    expect(screen.getByText("읽은 파일 5개 · 탐색 라운드 1/3")).toBeInTheDocument();
  });

  it("shows the round counter while exploring more", () => {
    render(<ProgressStepper detail={detail({ stage: "exploring_more", progress: { ...detail().progress, round: 2, activity: "reading_files" } })} />);
    expect(screen.getByText("추가 탐색 2/3")).toHaveAttribute("aria-current", "step");
  });

  it("shows the queue position and waiting time while queued", () => {
    render(<ProgressStepper detail={detail({ status: "queued", stage: "queued", queuePosition: 3, createdAt: new Date(Date.now() - 5_000).toISOString() })} />);
    expect(screen.getByText(/대기 순서 3번째 · 대기 [45]초/)).toBeInTheDocument();
  });
});
