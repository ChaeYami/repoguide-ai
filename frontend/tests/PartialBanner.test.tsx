import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PartialBanner } from "../src/components/PartialBanner";

describe("PartialBanner", () => {
  it("lists partial reasons and limitations for a partial manual (Constitution II)", () => {
    render(
      <PartialBanner
        reasons={[{ code: "round_limit", message: "탐색 라운드 한도에 도달해 일부 섹션은 확보한 정보로만 작성했습니다." }]}
        limitations={["탐색 라운드 한도에 도달해 일부 섹션은 확보한 정보로만 작성했습니다.", "테스트 폴더는 읽지 않았습니다."]}
      />,
    );
    expect(screen.getByText("일부만 분석된 매뉴얼입니다")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows limitations of a completed manual as scope notes", () => {
    render(<PartialBanner reasons={[]} limitations={["README 외에 분석할 수 있는 파일이 없어 README 내용만으로 작성했습니다."]} />);
    expect(screen.getByText("분석 범위 안내")).toBeInTheDocument();
  });

  it("renders nothing without reasons or limitations", () => {
    const { container } = render(<PartialBanner reasons={[]} limitations={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
