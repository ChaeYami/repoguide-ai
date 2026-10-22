import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { detail, ID, manual } from "./fixtures";

afterEach(() => vi.unstubAllGlobals());

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function stubApi(routes: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const route = routes[input];
      return route ? new Response(JSON.stringify(route.body), { status: route.status }) : new Response("{}", { status: 500 });
    }),
  );
}

describe("App routes", () => {
  it("renders the home page at /", () => {
    renderAt("/");
    expect(screen.getByRole("heading", { name: "저장소 매뉴얼 만들기" })).toBeInTheDocument();
  });

  it("shows progress for a running analysis", async () => {
    stubApi({ [`/api/analyses/${ID}`]: { status: 200, body: detail() } });
    renderAt(`/a/${ID}`);
    expect(await screen.findByRole("heading", { name: "acme/demo" })).toBeInTheDocument();
    expect(screen.getByText("파일 분석")).toHaveAttribute("aria-current", "step");
  });

  it("shows the manual and partial banner for a partial analysis", async () => {
    stubApi({
      [`/api/analyses/${ID}`]: { status: 200, body: detail({ status: "partial", stage: "done", hasManual: true, partialReasons: [{ code: "round_limit", message: "탐색 라운드 한도에 도달했습니다." }] }) },
      [`/api/analyses/${ID}/manual`]: { status: 200, body: manual() },
    });
    renderAt(`/a/${ID}`);
    expect(await screen.findByRole("heading", { name: "demo 설치 매뉴얼" })).toBeInTheDocument();
    expect(screen.getByText("일부만 분석된 매뉴얼입니다")).toBeInTheDocument();
  });

  it("shows the failure reason for a failed analysis", async () => {
    stubApi({
      [`/api/analyses/${ID}`]: {
        status: 200,
        body: detail({ status: "failed", stage: "done", failure: { code: "repo_empty", message: "저장소에 커밋이 없습니다.", action: "다른 저장소로 시도해 주세요.", retryAfterSec: null } }),
      },
    });
    renderAt(`/a/${ID}`);
    expect(await screen.findByText("저장소에 커밋이 없습니다.")).toBeInTheDocument();
  });

  it("explains an unknown analysis id", async () => {
    stubApi({ [`/api/analyses/${ID}`]: { status: 404, body: { error: { code: "not_found", message: "분석을 찾을 수 없습니다." } } } });
    renderAt(`/a/${ID}`);
    expect(await screen.findByRole("heading", { name: "분석을 찾을 수 없습니다." })).toBeInTheDocument();
  });

  it("renders the not-found page for unknown paths", () => {
    renderAt("/does-not-exist");
    expect(screen.getByRole("heading", { name: "페이지를 찾을 수 없습니다" })).toBeInTheDocument();
  });
});
