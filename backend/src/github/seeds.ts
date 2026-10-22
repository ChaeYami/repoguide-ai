import type { Candidate } from "../db/json-types.js";
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

export function selectSeeds(candidates: readonly Candidate[], subpath: string | null, max = MAX_SEEDS): Seed[] {
  const seeds: Seed[] = [];
  const add = (candidate: Candidate | undefined, rule: string) => {
    if (!candidate || seeds.length >= max || seeds.some((seed) => seed.path === candidate.path)) return;
    seeds.push({ path: candidate.path, rule });
  };

  if (subpath) add(readmesIn(candidates, subpath)[0], "subpath-readme");
  add(readmesIn(candidates, "")[0], "readme");
  if (subpath) {
    for (const manifest of manifestsIn(candidates, subpath)) {
      add(manifest, `subpath-manifest:${basename(manifest.path)}`);
    }
  }
  for (const manifest of manifestsIn(candidates, "")) add(manifest, `manifest:${basename(manifest.path)}`);

  return seeds;
}
