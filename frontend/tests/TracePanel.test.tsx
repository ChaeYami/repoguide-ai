import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TracePanel } from "../src/components/TracePanel";
import { SHA, trace } from "./fixtures";

describe("TracePanel", () => {
  it("lists read files with commit-pinned links, source, round and why they were chosen", () => {
    render(<TracePanel trace={trace()} />);
    const files = screen.getByRole("region", { name: "읽은 파일 (2개)" });
    const link = within(files).getByRole("link", { name: "src/server.ts" });
    expect(link).toHaveAttribute("href", `https://github.com/acme/demo/blob/${SHA}/src/server.ts`);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    const item = link.closest("li")!;
    expect(within(item).getByText("AI 요청")).toBeInTheDocument();
    expect(within(item).getByText("1라운드")).toBeInTheDocument();
    expect(within(item).getByText("앞부분만 읽음")).toBeInTheDocument();
    expect(within(item).getByText("요약만 반영")).toBeInTheDocument();
    expect(within(item).getByText("서버 진입점")).toBeInTheDocument();
    expect(within(files).getByText("시드")).toBeInTheDocument();
  });

  it("shows each decision with accepted and rejected requests in Korean", () => {
    render(<TracePanel trace={trace()} />);
    const decisions = screen.getByRole("region", { name: "AI 탐색 판단" });
    expect(within(decisions).getByText(/판단 #1 — 추가 탐색 필요/)).toBeInTheDocument();
    expect(within(decisions).getByText("(저장소에 없는 파일)")).toBeInTheDocument();
    expect(within(decisions).getByText("(파일 수 한도 초과)")).toBeInTheDocument();
    expect(within(decisions).getByText("run_commands: 충분")).toBeInTheDocument();
    expect(within(decisions).getByText("펼쳐 본 디렉터리: src/routes")).toBeInTheDocument();
  });

  it("shows the analyzed commit, stop reason, limit badge and usage against limits", () => {
    render(<TracePanel trace={trace()} />);
    const summary = screen.getByRole("region", { name: "요약" });
    expect(within(summary).getByText(SHA)).toBeInTheDocument();
    expect(within(summary).getByText(/파일 수 한도 도달/)).toBeInTheDocument();
    expect(within(summary).getByText("한도 도달")).toBeInTheDocument();
    expect(within(summary).getByText(/라운드 2\/3 · 읽은 파일 6\/40 · GitHub 9회 · \$0\.0421 \/ \$0\.30/)).toBeInTheDocument();
  });

  it("handles an analysis that has not recorded anything yet", () => {
    render(<TracePanel trace={trace({ files: [], decisions: [], stopReason: null, limitReached: false, repo: { ...trace().repo, commitSha: null } })} />);
    expect(screen.getByText("아직 읽은 파일이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("아직 판단 기록이 없습니다.")).toBeInTheDocument();
    expect(screen.getByText("확정 전")).toBeInTheDocument();
  });
});
