import type { DetectedStack, ParsedRepoUrl } from "@repoguide/shared";
import type { Candidate } from "../db/json-types.js";
import type { FileCache } from "../db/repositories/files.js";
import { readFiles, type ReadFileResult } from "../pipeline/file-reader.js";
import type { GitHubClient } from "./client.js";
import { resolveRepository, type ResolvedRepository } from "./resolve-ref.js";
import { findReadmeSymlinks, resolveLinkTarget, type Seed, selectSeeds } from "./seeds.js";
import { detectStack } from "./stack-detect.js";
import { filterTree, type FilterResult } from "./tree-filter.js";

// 분석의 결정적 앞단(validating_repo → scanning_structure): 저장소 확인, 커밋 고정, 트리 수집·필터,
// 시드 읽기, 스택 감지까지. LLM은 쓰지 않는다. 분석 파이프라인(T024)과 dev:ingest가 공유한다.

export interface IngestOptions {
  maxFileBytes: number;
  maxCharsPerFile: number;
  /** 시드 원문 캐시. 스냅샷 id는 캐시를 쓰는 쪽이 정한다. */
  cache?: { snapshotId: string; store: FileCache };
  onProgress?: (done: number, total: number) => void;
}

export interface IngestResult extends ResolvedRepository {
  treeTruncated: boolean;
  treeEntryCount: number;
  filter: FilterResult;
  candidates: Candidate[];
  seeds: (Seed & ReadFileResult)[];
  detectedStack: DetectedStack;
}

export type IngestClient = Pick<GitHubClient, "getRepo" | "getCommitSha" | "getTree" | "getFileRaw" | "getBlobText">;

/**
 * 저장소를 확인하고 트리를 거른다. 시드는 아직 읽지 않는다(캐시용 스냅샷을 먼저 만들 수 있도록).
 * @param options.onResolved 커밋을 고정한 직후 호출된다(진행 단계 전환용).
 */
export async function scanRepository(
  client: IngestClient,
  parsed: ParsedRepoUrl,
  options: Pick<IngestOptions, "maxFileBytes"> & { onResolved?: () => Promise<void> },
) {
  const resolved = await resolveRepository(client, parsed);
  await options.onResolved?.();
  const { owner, name } = resolved.repo;
  const tree = await client.getTree(owner, name, resolved.commitSha);
  const filter = filterTree(tree.entries, { maxFileBytes: options.maxFileBytes });

  // README가 심볼릭 링크뿐이면 링크 대상 파일을 시드로 쓴다 (예: 모노레포 루트 readme.md → packages/x/README.md).
  const dirs = [...new Set(["", ...(resolved.subpath ? [resolved.subpath] : [])])];
  const readmeFallbacks = new Map<string, string>();
  const byPath = new Set(filter.candidates.map((candidate) => candidate.path));
  for (const { dir, entry } of findReadmeSymlinks(tree.entries, filter.candidates, dirs)) {
    const target = resolveLinkTarget(entry.path, await client.getBlobText(owner, name, entry.sha));
    if (target && byPath.has(target)) readmeFallbacks.set(dir, target);
  }

  return {
    ...resolved,
    treeTruncated: tree.truncated,
    treeEntryCount: tree.entries.length,
    filter,
    candidates: filter.candidates,
    directories: new Set(tree.entries.filter((entry) => entry.type === "tree").map((entry) => entry.path)),
    seedPlan: selectSeeds(filter.candidates, resolved.subpath, undefined, readmeFallbacks),
  };
}

export async function ingestRepository(
  client: IngestClient,
  parsed: ParsedRepoUrl,
  options: IngestOptions,
): Promise<IngestResult> {
  const { seedPlan, ...scanned } = await scanRepository(client, parsed, options);
  const byPath = new Map(scanned.candidates.map((candidate) => [candidate.path, candidate]));

  const read = await readFiles({
    client,
    owner: scanned.repo.owner,
    name: scanned.repo.name,
    commitSha: scanned.commitSha,
    files: seedPlan.map((seed) => byPath.get(seed.path)!),
    maxCharsPerFile: options.maxCharsPerFile,
    cache: options.cache,
    onProgress: options.onProgress,
  });
  const seeds = seedPlan.map((seed, index) => ({ ...read[index]!, ...seed }));

  const manifestContents = Object.fromEntries(
    seeds.flatMap((seed) => (seed.rule.includes("manifest") && seed.content !== null ? [[seed.path, seed.content]] : [])),
  );
  const detectedStack = detectStack({
    paths: scanned.candidates.map((candidate) => candidate.path),
    lockfiles: scanned.filter.lockfiles,
    manifestContents,
  });

  return { ...scanned, seeds, detectedStack };
}
