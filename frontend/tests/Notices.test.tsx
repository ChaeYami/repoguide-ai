import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FailureNotice } from "../src/components/FailureNotice";
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

describe("FailureNotice", () => {
  it("shows the fixed message and the action", () => {
    render(
      <FailureNotice
        failure={{ code: "repo_not_found_or_private", message: "저장소를 찾을 수 없거나 비공개 저장소입니다. 공개 저장소만 지원합니다.", action: "URL이 맞는지 확인해 주세요.", retryAfterSec: null }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("공개 저장소만 지원합니다");
    expect(screen.getByText("URL이 맞는지 확인해 주세요.")).toBeInTheDocument();
  });
});
