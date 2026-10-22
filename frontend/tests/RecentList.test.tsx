import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecentList } from "../src/components/RecentList";
import { rememberAnalysis } from "../src/lib/recent-store";
import { renderWithProviders } from "./render";

const LIVE = "11111111-1111-4111-8111-111111111111";
const GONE = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  window.localStorage.clear();
  rememberAnalysis({ id: GONE, owner: "acme", name: "old", level: "developer", purpose: "understand", createdAt: "2026-09-01T03:00:00.000Z" });
  rememberAnalysis({ id: LIVE, owner: "acme", name: "demo", level: "beginner", purpose: "setup", createdAt: "2026-10-22T03:00:00.000Z" });
});
afterEach(() => vi.unstubAllGlobals());

function stubBatch() {
  const fetchMock = vi.fn(async (_input: string) =>
    new Response(
      JSON.stringify({
        items: [
          {
            id: LIVE,
            repo: { owner: "acme", name: "demo", ref: "main", commitSha: null, subpath: null, htmlUrl: "https://github.com/acme/demo" },
            level: "beginner",
            purpose: "setup",
            status: "completed",
            createdAt: "2026-10-22T03:00:00.000Z",
            finishedAt: "2026-10-22T03:02:00.000Z",
          },
        ],
        missingIds: [GONE],
      }),
      { status: 200 },
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("RecentList", () => {
  it("shows recent analyses with their current status and marks missing ones as expired", async () => {
    const fetchMock = stubBatch();
    renderWithProviders(<RecentList />);
    const list = screen.getByRole("region", { name: "최근 분석" });
    expect(await within(list).findByText(/완료$/)).toBeInTheDocument();
    expect(within(list).getByRole("link", { name: "acme/demo" })).toHaveAttribute("href", `/a/${LIVE}`);
    expect(within(list).getByText(/만료됨$/)).toBeInTheDocument();
    expect(within(list).queryByRole("link", { name: "acme/old" })).toBeNull();
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`/api/analyses?ids=${LIVE},${GONE}`);
  });

  it("removes an entry from the list", async () => {
    stubBatch();
    renderWithProviders(<RecentList />);
    await userEvent.setup().click(screen.getByRole("button", { name: "acme/old 목록에서 지우기" }));
    expect(screen.queryByText("acme/old")).toBeNull();
  });

  it("renders nothing and makes no request when the list is empty or storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    const fetchMock = stubBatch();
    const { container } = renderWithProviders(<RecentList />);
    expect(container).toBeEmptyDOMElement();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });
});
