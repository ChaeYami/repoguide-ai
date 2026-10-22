import type { Candidate } from "../db/json-types.js";

// Decide(LLM)에 넘기는 파일 목록. 상한을 넘으면 깊은 디렉터리를 "dir/ (N files)"로 접고,
// Decide가 펼치기를 요청한 디렉터리는 개별 파일로 보여준다 (research R7). GitHub 호출은 들지 않는다.

export const DEFAULT_MAX_LISTING_ENTRIES = 2_000;

export interface TreeListing {
  text: string;
  lineCount: number;
  /** 접힌 디렉터리. Decide가 expandDirectories로 펼칠 수 있다. */
  collapsedDirectories: string[];
  /** 상한 때문에 아예 빠진 줄 수 */
  omitted: number;
}

interface Line {
  sortKey: string;
  text: string;
  collapsedDir?: string;
}

function isUnder(path: string, dir: string): boolean {
  return dir === "" || path.startsWith(`${dir}/`);
}

function linesAtDepth(candidates: readonly Candidate[], depth: number, expanded: readonly string[]): Line[] {
  const lines: Line[] = [];
  const collapsed = new Map<string, number>();
  for (const candidate of candidates) {
    const segments = candidate.path.split("/");
    if (segments.length <= depth || expanded.some((dir) => isUnder(candidate.path, dir))) {
      lines.push({ sortKey: candidate.path, text: `${candidate.path} (${candidate.size} B)` });
    } else {
      const dir = segments.slice(0, depth).join("/");
      collapsed.set(dir, (collapsed.get(dir) ?? 0) + 1);
    }
  }
  for (const [dir, count] of collapsed) {
    lines.push({ sortKey: `${dir}/`, text: `${dir}/ (${count} files)`, collapsedDir: dir });
  }
  return lines.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));
}

export function buildTreeListing(
  candidates: readonly Candidate[],
  options: { maxEntries?: number; expanded?: readonly string[] } = {},
): TreeListing {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_LISTING_ENTRIES;
  const expanded = options.expanded ?? [];
  const maxDepth = Math.max(1, ...candidates.map((candidate) => candidate.path.split("/").length));

  // 상한 안에 들어오는 가장 깊은 수준을 고른다. 1단계까지 접어도 넘치면 앞부분만 남긴다.
  let lines = linesAtDepth(candidates, 1, expanded);
  for (let depth = maxDepth; depth >= 1; depth -= 1) {
    const attempt = linesAtDepth(candidates, depth, expanded);
    if (attempt.length <= maxEntries) {
      lines = attempt;
      break;
    }
  }

  const kept = lines.slice(0, maxEntries);
  const omitted = lines.length - kept.length;
  const text = kept.map((line) => line.text).join("\n") + (omitted > 0 ? `\n... (${omitted} more)` : "");
  return {
    text,
    lineCount: kept.length,
    collapsedDirectories: kept.flatMap((line) => (line.collapsedDir ? [line.collapsedDir] : [])),
    omitted,
  };
}
