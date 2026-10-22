import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { forgetAnalysis, loadRecent, MAX_RECENT, RECENT_KEY, rememberAnalysis, type RecentEntry } from "../src/lib/recent-store";

const entry = (n: number): RecentEntry => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  owner: "acme",
  name: `repo${n}`,
  level: "beginner",
  purpose: "setup",
  createdAt: "2026-10-22T03:00:00.000Z",
});

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("recent-store", () => {
  it("keeps newest first, dedupes by id and caps at 20", () => {
    for (let i = 0; i < 25; i += 1) rememberAnalysis(entry(i));
    rememberAnalysis(entry(10));
    const list = loadRecent();
    expect(list).toHaveLength(MAX_RECENT);
    expect(list[0]!.name).toBe("repo10");
    expect(list.filter((item) => item.name === "repo10")).toHaveLength(1);
    expect(list.map((item) => item.name)).not.toContain("repo4");
  });

  it("forgets an entry", () => {
    rememberAnalysis(entry(1));
    rememberAnalysis(entry(2));
    expect(forgetAnalysis(entry(1).id).map((item) => item.name)).toEqual(["repo2"]);
  });

  it("ignores corrupted or malformed storage", () => {
    window.localStorage.setItem(RECENT_KEY, "{not json");
    expect(loadRecent()).toEqual([]);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([{ id: 1 }, entry(3)]));
    expect(loadRecent().map((item) => item.name)).toEqual(["repo3"]);
  });

  it("keeps working when storage throws (private mode, blocked site data)", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    expect(loadRecent()).toEqual([]);
    expect(() => rememberAnalysis(entry(1))).not.toThrow();
    expect(() => forgetAnalysis(entry(1).id)).not.toThrow();
  });
});
