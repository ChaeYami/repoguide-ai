import type { Candidate } from "../db/json-types.js";
import type { TreeEntry } from "./client.js";
import { basename } from "./tree-filter.js";

// 코드가 항상 먼저 읽는 시드 파일 (research R7). 저장소 구조에서 동적으로 정해지고,
// 나머지 파일의 우선순위는 Decide(LLM)가 판단한다.

export const MAX_SEEDS = 6;

export interface Seed {
  path: string;
  /** explored_files.reason에 기록하는 선택 규칙 */
  rule: string;
}

// 앞에 있을수록 우선한다.
export const MANIFEST_NAMES = [
  "package.json",
  "pyproject.toml",
  "requirements.txt",
  "setup.py",
  "go.mod",
  "cargo.toml",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "gemfile",
  "composer.json",
  "*.csproj",
  "makefile",
  "dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".env.example",
];

const README_PATTERN = /^readme(\.[a-z0-9]+)?$/i;

function dirname(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function manifestRank(name: string): number {
  const lower = name.toLowerCase();
  return MANIFEST_NAMES.indexOf(lower.endsWith(".csproj") ? "*.csproj" : lower);
}

function filesIn(candidates: readonly Candidate[], dir: string) {
  return candidates.filter((candidate) => dirname(candidate.path) === dir);
}

function readmesIn(candidates: readonly Candidate[], dir: string) {
  // README.md를 다른 형식(README.rst 등)보다 먼저 둔다.
  return filesIn(candidates, dir)
    .filter((candidate) => README_PATTERN.test(basename(candidate.path)))
    .sort((a, b) => Number(!/\.md$/i.test(a.path)) - Number(!/\.md$/i.test(b.path)));
}

function manifestsIn(candidates: readonly Candidate[], dir: string) {
  return filesIn(candidates, dir)
    .map((candidate) => ({ candidate, rank: manifestRank(basename(candidate.path)) }))
    .filter(({ rank }) => rank !== -1)
    .sort((a, b) => a.rank - b.rank)
    .map(({ candidate }) => candidate);
}

/** README가 일반 파일로 없는 디렉터리에서 README 이름의 심볼릭 링크를 찾는다 (모노레포의 루트 readme.md 등). */
export function findReadmeSymlinks(
  entries: readonly TreeEntry[],
  candidates: readonly Candidate[],
  dirs: readonly string[],
): { dir: string; entry: TreeEntry }[] {
  return dirs.flatMap((dir) => {
    if (readmesIn(candidates, dir).length > 0) return [];
    const entry = entries.find(
      (item) => item.mode === "120000" && dirname(item.path) === dir && README_PATTERN.test(basename(item.path)),
    );
    return entry ? [{ dir, entry }] : [];
  });
}

/** 링크 위치 기준으로 대상 경로를 정규화한다. 저장소 밖을 가리키면 null. */
export function resolveLinkTarget(linkPath: string, target: string): string | null {
  const trimmed = target.trim();
  if (!trimmed || trimmed.startsWith("/")) return null;
  const parts = dirname(linkPath) ? dirname(linkPath).split("/") : [];
  for (const segment of trimmed.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length > 0 ? parts.join("/") : null;
}

/**
 * @param readmeFallbacks 디렉터리 → 심볼릭 링크 README가 가리키는 후보 경로. 그 디렉터리에 README 파일이 없을 때 쓴다.
 */
export function selectSeeds(
  candidates: readonly Candidate[],
  subpath: string | null,
  max = MAX_SEEDS,
  readmeFallbacks: ReadonlyMap<string, string> = new Map(),
): Seed[] {
  const seeds: Seed[] = [];
  const add = (candidate: Candidate | undefined, rule: string) => {
    if (!candidate || seeds.length >= max || seeds.some((seed) => seed.path === candidate.path)) return;
    seeds.push({ path: candidate.path, rule });
  };
  const readmeOf = (dir: string, rule: string) => {
    const regular = readmesIn(candidates, dir)[0];
    if (regular) return add(regular, rule);
    const linked = readmeFallbacks.get(dir);
    add(linked ? candidates.find((candidate) => candidate.path === linked) : undefined, `${rule}(symlink)`);
  };

  if (subpath) readmeOf(subpath, "subpath-readme");
  readmeOf("", "readme");
  if (subpath) {
    for (const manifest of manifestsIn(candidates, subpath)) {
      add(manifest, `subpath-manifest:${basename(manifest.path)}`);
    }
  }
  for (const manifest of manifestsIn(candidates, "")) add(manifest, `manifest:${basename(manifest.path)}`);

  return seeds;
}
