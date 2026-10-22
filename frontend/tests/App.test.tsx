import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "../src/App";
import { rememberAnalysis } from "../src/lib/recent-store";
import { detail, ID, manual, trace } from "./fixtures";

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

describe("analysis tabs", () => {
  it("switches to the trace tab and loads the trace", async () => {
    stubApi({
      [`/api/analyses/${ID}`]: { status: 200, body: detail({ status: "completed", stage: "done", hasManual: true }) },
      [`/api/analyses/${ID}/manual`]: { status: 200, body: manual() },
      [`/api/analyses/${ID}/trace`]: { status: 200, body: trace() },
    });
    renderAt(`/a/${ID}`);
    await screen.findByRole("heading", { name: "demo 설치 매뉴얼" });
    await userEvent.setup().click(screen.getByRole("tab", { name: "분석 내역" }));
    expect(await screen.findByRole("heading", { name: "AI 탐색 판단" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "분석 내역" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("expired analyses", () => {
  it("offers to analyze the same repository again with the same options (R17)", async () => {
    window.localStorage.clear();
    rememberAnalysis({ id: ID, owner: "acme", name: "demo", level: "developer", purpose: "modify", createdAt: "2026-09-01T00:00:00.000Z" });
    stubApi({ [`/api/analyses/${ID}`]: { status: 410, body: { error: { code: "expired", message: "보관 기간이 지나 결과가 삭제되었습니다.", action: "같은 저장소를 다시 분석해 주세요." } } } });
    renderAt(`/a/${ID}`);
    expect(await screen.findByRole("heading", { name: "보관 기간이 지나 결과가 삭제되었습니다." })).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("link", { name: "acme/demo 다시 분석하기" }));
    expect(await screen.findByLabelText("GitHub 저장소 URL")).toHaveValue("https://github.com/acme/demo");
    expect(screen.getByLabelText(/일반 개발자/)).toBeChecked();
    expect(screen.getByLabelText(/코드 수정 및 확장/)).toBeChecked();
    expect(screen.getByRole("button", { name: "분석 시작" })).toBeEnabled();
  });
});

describe("regeneration from the analysis page", () => {
  it("requests a regeneration and navigates to the new analysis", async () => {
    const NEW_ID = "55555555-5555-4555-8555-555555555555";
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${input}`);
        if (input === `/api/analyses/${ID}`) return new Response(JSON.stringify(detail({ status: "completed", stage: "done", hasManual: true })), { status: 200 });
        if (input === `/api/analyses/${ID}/manual`) return new Response(JSON.stringify(manual()), { status: 200 });
        if (input === `/api/analyses/${ID}/freshness`) {
          return new Response(JSON.stringify({ analyzedCommitSha: "a".repeat(40), latestCommitSha: "a".repeat(40), isOutdated: false, checkedAt: new Date().toISOString() }), { status: 200 });
        }
        if (input === `/api/analyses/${ID}/regenerations`) return new Response(JSON.stringify({ id: NEW_ID, status: "queued" }), { status: 202 });
        if (input === `/api/analyses/${NEW_ID}`) return new Response(JSON.stringify(detail({ id: NEW_ID, level: "developer", status: "queued", stage: "queued", queuePosition: 1 })), { status: 200 });
        return new Response("{}", { status: 500 });
      }),
    );
    renderAt(`/a/${ID}`);
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "demo 설치 매뉴얼" });
    const panel = screen.getByRole("region", { name: "다른 조건으로 다시 만들기" });
    await user.click(within(panel).getByLabelText(/일반 개발자/));
    await user.click(within(panel).getByRole("button", { name: "이 조건으로 다시 만들기" }));
    expect(await screen.findByText(/대기 순서 1번째/)).toBeInTheDocument();
    expect(calls).toContain(`POST /api/analyses/${ID}/regenerations`);
  });
});
