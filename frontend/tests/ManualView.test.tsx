import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ManualView } from "../src/components/ManualView";
import { manual, SHA } from "./fixtures";

describe("ManualView", () => {
  it("renders sections in catalog order", () => {
    render(<ManualView manual={manual()} />);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual(
      expect.arrayContaining(["실행 환경", "의존성", "설치 절차", "설정 파일", "실행 명령", "정상 동작 확인"]),
    );
  });

  it("marks facts and inferences differently, including downgraded ones (FR-026)", () => {
    render(<ManualView manual={manual()} />);
    const environment = screen.getByRole("region", { name: "실행 환경" });
    expect(within(environment).getByText("확인됨")).toBeInTheDocument();
    const downgraded = within(environment).getByText("추론(근거 확인 실패)");
    expect(downgraded).toHaveAttribute("title", "근거를 확인하지 못해 추론으로 표시했습니다");
  });

  it("links evidence to the commit-pinned GitHub line range in a new tab (FR-024)", () => {
    render(<ManualView manual={manual()} />);
    const chip = screen.getByRole("link", { name: "package.json:L2-L9" });
    expect(chip).toHaveAttribute("href", `https://github.com/acme/demo/blob/${SHA}/package.json#L2-L9`);
    expect(chip).toHaveAttribute("target", "_blank");
    expect(chip).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("shows step details for beginners", () => {
    render(<ManualView manual={manual()} />);
    const steps = screen.getByRole("region", { name: "설치 절차" });
    expect(within(steps).getByText("단계 1")).toBeInTheDocument();
    expect(within(steps).getByText("npm install")).toBeInTheDocument();
    expect(within(steps).getByText("added 120 packages")).toBeInTheDocument();
    expect(within(steps).getByText("Node 버전을 확인하세요")).toBeInTheDocument();
  });

  it("says 'not found in the repository' for empty sections (FR-022)", () => {
    render(<ManualView manual={manual()} />);
    expect(within(screen.getByRole("region", { name: "의존성" })).getByText(/저장소에서 확인되지 않음/)).toBeInTheDocument();
  });

  it("never renders raw HTML or javascript: links from the model", () => {
    const { container } = render(<ManualView manual={manual()} />);
    expect(container.querySelector("script")).toBeNull();
    const link = screen.queryByRole("link", { name: "위험" });
    expect(link?.getAttribute("href") ?? "").not.toMatch(/^javascript:/i);
  });

  it("shows beginner extras", () => {
    render(<ManualView manual={manual()} />);
    expect(screen.getByText("시작하기 전에 알아 둘 것")).toBeInTheDocument();
    expect(screen.getByText("npm")).toBeInTheDocument();
  });
});
