import type { Level, Purpose } from "@repoguide/shared";

// 브라우저 최근 분석 목록 (FR-030, research R14). 이 브라우저에만 저장되는 편의 기능이라
// 저장소 접근이 실패해도(시크릿 창, 차단, 손상된 값) 화면은 그대로 동작해야 한다.

export const RECENT_KEY = "repoguide.recent.v1";
export const MAX_RECENT = 20;

export interface RecentEntry {
  id: string;
  owner: string;
  name: string;
  level: Level;
  purpose: Purpose;
  createdAt: string;
}

function isEntry(value: unknown): value is RecentEntry {
  const entry = value as Partial<RecentEntry> | null;
  return (
    typeof entry?.id === "string" &&
    typeof entry.owner === "string" &&
    typeof entry.name === "string" &&
    typeof entry.level === "string" &&
    typeof entry.purpose === "string" &&
    typeof entry.createdAt === "string"
  );
}

export function loadRecent(): RecentEntry[] {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter(isEntry).slice(0, MAX_RECENT) : [];
  } catch {
    return [];
  }
}

function save(entries: RecentEntry[]) {
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(entries));
  } catch {
    // 저장할 수 없어도 목록 기능만 빠질 뿐이다.
  }
}

/** 맨 앞에 추가한다. 같은 분석은 하나만 남기고 최대 20개를 유지한다. */
export function rememberAnalysis(entry: RecentEntry): RecentEntry[] {
  const next = [entry, ...loadRecent().filter((item) => item.id !== entry.id)].slice(0, MAX_RECENT);
  save(next);
  return next;
}

export function forgetAnalysis(id: string): RecentEntry[] {
  const next = loadRecent().filter((item) => item.id !== id);
  save(next);
  return next;
}
