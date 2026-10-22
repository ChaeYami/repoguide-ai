import type { FailureCode, PartialReason } from "@repoguide/shared";
import { PARTIAL_MESSAGES } from "../api/messages.js";
import type { Candidate, FileNote } from "../db/json-types.js";
import type { AnalysisOutcome, AnalysisRow } from "../db/repositories/analyses.js";
import type { Repositories } from "../db/repositories/index.js";
import type { SnapshotRow } from "../db/repositories/snapshots.js";
import { GitHubError } from "../github/client.js";
import { type IngestClient, scanRepository } from "../github/ingest.js";
import { detectStack } from "../github/stack-detect.js";
import type { ExclusionReason } from "../github/tree-filter.js";
import { RunTimeoutError, type WorkerLogger } from "../jobs/worker.js";
import { LlmError, type LlmClient } from "../llm/client.js";
import type { RepoContext } from "../llm/prompts/context.js";
import { BudgetGuard, isLimitStop } from "./budget.js";
import { runExploration, type WorkingFile } from "./explore-loop.js";
import { readFiles, type ReadFileResult } from "./file-reader.js";
import { parsedFromAnalysis } from "./new-analysis.js";
import { ProgressReporter } from "./progress.js";
import { ManualGenerationError, writeManual, WriteLimitError } from "./write-manual.js";

// 분석 오케스트레이터 (FR-006~FR-019, FR-028, data-model.md 상태 전이).
// 준비(새 분석: validating_repo → scanning_structure / 재생성: 부모 재사용) → 탐색 루프 → writing_manual → done.

export type AnalysisGitHub = IngestClient;

/** 실행 시간 상한 중 매뉴얼 작성 몫으로 남겨 두는 비율. 탐색은 나머지 시간 안에서만 한다. */
export const WRITE_TIME_RESERVE_RATIO = 0.5;
/** Gemini는 재시도 시각을 알려 주지 않으므로 사용량 제한 실패는 이 시간 뒤 재시도를 안내한다. */
export const LLM_RETRY_AFTER_SEC = 60;

export interface RunDeps {
  repos: Repositories;
  llm: LlmClient;
  /** 실행마다 호출 수를 예산에 집계하는 GitHub 클라이언트를 만든다. */
  github: (onCall: () => void) => AnalysisGitHub;
  models: { decide: string; write: string };
  logger?: WorkerLogger;
  now?: () => Date;
}

export class NoAnalyzableFilesError extends Error {
  constructor() {
    super("no analyzable files");
    this.name = "NoAnalyzableFilesError";
  }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new RunTimeoutError();
}

function toFailure(error: unknown, signal: AbortSignal, now: Date): { code: FailureCode; retryAt: Date | null } {
  if (error instanceof RunTimeoutError || signal.reason instanceof RunTimeoutError) return { code: "timeout", retryAt: null };
  if (error instanceof GitHubError) {
    if (error.code === "file_not_found") return { code: "internal_error", retryAt: null };
    const retryAt = error.retryAfterSec ? new Date(now.getTime() + error.retryAfterSec * 1000) : null;
    return { code: error.code, retryAt };
  }
  if (error instanceof LlmError) {
    if (error.code === "llm_rate_limited") return { code: error.code, retryAt: new Date(now.getTime() + LLM_RETRY_AFTER_SEC * 1000) };
    return { code: error.code === "llm_invalid_output" ? "manual_generation_failed" : error.code, retryAt: null };
  }
  if (error instanceof WriteLimitError) return { code: "limit_reached", retryAt: null };
  if (error instanceof ManualGenerationError) return { code: "manual_generation_failed", retryAt: null };
  if (error instanceof NoAnalyzableFilesError) return { code: "no_analyzable_files", retryAt: null };
  return { code: "internal_error", retryAt: null };
}

export async function runAnalysis(analysis: AnalysisRow, signal: AbortSignal, deps: RunDeps): Promise<void> {
  const { repos } = deps;
  const now = deps.now ?? (() => new Date());
  const budget = new BudgetGuard(analysis.limits);
  const progress = new ProgressReporter(repos.analyses, analysis.id, analysis.progress);
  const github = deps.github(() => budget.recordGithubCall());

  let outcome: AnalysisOutcome;
  try {
    outcome = await execute(analysis, signal, { ...deps, github }, budget, progress, now);
  } catch (error) {
    const failure = toFailure(error, signal, now());
    (failure.code === "internal_error" ? deps.logger?.error : deps.logger?.warn)?.call(
      deps.logger,
      { err: error, analysisId: analysis.id, failureCode: failure.code },
      "analysis failed",
    );
    outcome = { status: "failed", failureCode: failure.code, failureRetryAt: failure.retryAt, usage: budget.snapshot() };
  }
  await repos.analyses.finish(analysis.id, outcome);
}

/** 탐색 전에 갖춰야 하는 것. 새 분석은 GitHub에서 수집하고, 재생성(change_options)은 부모 분석을 재사용한다. */
interface PreparedRun {
  snapshot: SnapshotRow;
  repoContext: RepoContext;
  candidates: Candidate[];
  excluded: ReadonlyMap<string, ExclusionReason>;
  directories: ReadonlySet<string>;
  initialFiles: WorkingFile[];
  initialNotes: FileNote[];
  treeTruncated: boolean;
  ensureRepoAvailable: (results: readonly ReadFileResult[]) => Promise<void>;
}

type ExecuteDeps = Omit<RunDeps, "github"> & { github: AnalysisGitHub };

async function execute(
  analysis: AnalysisRow,
  signal: AbortSignal,
  deps: ExecuteDeps,
  budget: BudgetGuard,
  progress: ProgressReporter,
  now: () => Date,
): Promise<AnalysisOutcome> {
  const { limits } = budget;
  // 실행 시간의 일부를 매뉴얼 작성 몫으로 남겨, 탐색이 길어져도 확보한 정보로 매뉴얼을 쓸 수 있게 한다.
  const exploreDeadline = now().getTime() + limits.runTimeoutSec * 1000 * (1 - WRITE_TIME_RESERVE_RATIO);
  const prepared =
    analysis.regenerationMode === "change_options"
      ? await prepareReuse(analysis, deps, budget, progress)
      : await prepareFresh(analysis, signal, deps, budget, progress);
  throwIfAborted(signal);
  return exploreAndWrite(analysis, prepared, signal, deps, budget, progress, now, exploreDeadline);
}

/** validating_repo(공개 여부, ref 해석, 커밋 고정) → scanning_structure(트리 수집·필터, 시드 읽기, 스냅샷) */
async function prepareFresh(
  analysis: AnalysisRow,
  signal: AbortSignal,
  deps: ExecuteDeps,
  budget: BudgetGuard,
  progress: ProgressReporter,
): Promise<PreparedRun> {
  const { repos, github } = deps;
  const { limits } = budget;
  await progress.update({ stage: "validating_repo" });
  const scanned = await scanRepository(github, parsedFromAnalysis(analysis), {
    maxFileBytes: limits.maxFileBytes,
    onResolved: async () => {
      throwIfAborted(signal);
      await progress.update({ stage: "scanning_structure" });
    },
  });
  const { repo, commitSha, filter, seedPlan, directories } = scanned;
  if (filter.candidates.length === 0) throw new NoAnalyzableFilesError();
  const byPath = new Map(filter.candidates.map((candidate) => [candidate.path, candidate]));
  // 고정한 커밋의 파일이 404이면 분석 도중 저장소가 삭제·비공개 전환된 것인지 확인한다.
  const ensureRepoAvailable = async (results: readonly ReadFileResult[]) => {
    if (results.some((result) => result.skippedReason === "not_found")) await github.getRepo(repo.owner, repo.name);
  };
  const seedCandidates = seedPlan.map((seed) => byPath.get(seed.path)!);

  const ownerKey = repo.owner.toLowerCase();
  const nameKey = repo.name.toLowerCase();
  const read = (files: Candidate[], snapshotId?: string) =>
    readFiles({
      client: github,
      owner: repo.owner,
      name: repo.name,
      commitSha,
      files,
      maxCharsPerFile: limits.maxCharsPerFile,
      ...(snapshotId ? { cache: { snapshotId, store: repos.files } } : {}),
    });

  let snapshot = await repos.snapshots.findByCommit(ownerKey, nameKey, commitSha);
  let seedResults: ReadFileResult[];
  if (snapshot) {
    seedResults = await read(seedCandidates, snapshot.id);
    await ensureRepoAvailable(seedResults);
  } else {
    const fresh = await read(seedCandidates);
    await ensureRepoAvailable(fresh);
    const manifestContents = Object.fromEntries(
      seedPlan.flatMap((seed, index) =>
        seed.rule.includes("manifest") && fresh[index]?.content ? [[seed.path, fresh[index]!.content!]] : [],
      ),
    );
    snapshot = await repos.snapshots.upsert({
      owner: ownerKey,
      name: nameKey,
      commitSha,
      ref: scanned.ref,
      defaultBranch: repo.defaultBranch,
      description: repo.description,
      primaryLanguage: repo.language,
      treeEntryCount: scanned.treeEntryCount,
      candidateCount: filter.candidates.length,
      treeTruncated: scanned.treeTruncated,
      candidates: filter.candidates,
      detectedStack: detectStack({
        paths: filter.candidates.map((candidate) => candidate.path),
        lockfiles: filter.lockfiles,
        manifestContents,
      }),
    });
    seedResults = [];
    for (const [index, result] of fresh.entries()) {
      const stored = await repos.files.upsertSnapshotFile({
        snapshotId: snapshot.id,
        path: result.path,
        blobSha: seedCandidates[index]!.blobSha,
        sizeBytes: result.sizeBytes,
        content: result.content,
        lineCount: result.lineCount,
        truncated: result.truncated,
        skippedReason: result.skippedReason,
      });
      seedResults.push({ ...result, snapshotFileId: stored.id });
    }
  }
  await repos.analyses.attachSnapshot(analysis.id, snapshot.id, scanned.subpath);
  budget.recordFilesRead(seedResults.length);
  await progress.update({ filesRead: seedResults.length, filesPlanned: seedResults.length });

  return {
    snapshot,
    repoContext: {
      owner: repo.owner,
      name: repo.name,
      description: repo.description,
      language: repo.language,
      ref: scanned.ref,
      commitSha,
      subpath: scanned.subpath,
    },
    candidates: filter.candidates,
    excluded: new Map(filter.excluded.map((item) => [item.path, item.reason])),
    directories,
    initialFiles: seedResults.map((result, index) => ({
      ...result,
      snapshotFileId: result.snapshotFileId!,
      source: "seed",
      roundNo: 1,
      reason: seedPlan[index]!.rule,
    })),
    initialNotes: [],
    treeTruncated: scanned.treeTruncated,
    ensureRepoAvailable,
  };
}

/**
 * 재생성(change_options): 부모와 같은 스냅샷을 쓰고, 부모가 읽은 파일과 노트를 그대로 넘겨받는다(research R15).
 * 저장소 확인·구조 파악을 건너뛰므로 GitHub 호출은 새로 읽는 파일에만 든다.
 */
async function prepareReuse(analysis: AnalysisRow, deps: ExecuteDeps, budget: BudgetGuard, progress: ProgressReporter): Promise<PreparedRun> {
  const { repos, github } = deps;
  const parentId = analysis.parentAnalysisId;
  const snapshot = analysis.snapshotId ? await repos.snapshots.getById(analysis.snapshotId) : null;
  if (!parentId || !snapshot) throw new Error("change_options regeneration requires a parent analysis and its snapshot");

  const [parentFiles, parentRounds] = await Promise.all([
    repos.files.listWorkingSet(parentId, { withContent: true }),
    repos.rounds.listByAnalysis(parentId),
  ]);
  const initialFiles: WorkingFile[] = parentFiles.map((file) => ({
    path: file.path,
    sizeBytes: file.sizeBytes,
    content: file.content,
    lineCount: file.lineCount,
    truncated: file.truncated,
    skippedReason: (file.skippedReason as WorkingFile["skippedReason"]) ?? null,
    snapshotFileId: file.snapshotFileId,
    source: "reused",
    roundNo: 0,
    reason: `이전 분석에서 재사용: ${file.reason}`,
  }));
  budget.recordFilesRead(initialFiles.length);
  await progress.update({ stage: "selecting_files", filesRead: initialFiles.length, filesPlanned: initialFiles.length });

  // 트리 전체 항목은 저장하지 않으므로 디렉터리는 후보 경로에서 되살린다.
  const directories = new Set<string>();
  for (const candidate of snapshot.candidates) {
    const parts = candidate.path.split("/");
    for (let i = 1; i < parts.length; i += 1) directories.add(parts.slice(0, i).join("/"));
  }

  return {
    snapshot,
    repoContext: {
      owner: snapshot.owner,
      name: snapshot.name,
      description: snapshot.description,
      language: snapshot.primaryLanguage,
      ref: snapshot.ref,
      commitSha: snapshot.commitSha,
      subpath: analysis.subpath,
    },
    candidates: snapshot.candidates,
    // 제외 목록은 스냅샷에 없다. 제외된 파일을 요청하면 not_in_tree로 거절된다.
    excluded: new Map(),
    directories,
    initialFiles,
    initialNotes: parentRounds.flatMap((round) => round.fileNotes),
    treeTruncated: snapshot.treeTruncated,
    ensureRepoAvailable: async (results) => {
      if (results.some((result) => result.skippedReason === "not_found")) await github.getRepo(snapshot.owner, snapshot.name);
    },
  };
}

/** 탐색 루프(Decide ↔ 읽기) → writing_manual → 상태 판정 */
async function exploreAndWrite(
  analysis: AnalysisRow,
  prepared: PreparedRun,
  signal: AbortSignal,
  deps: ExecuteDeps,
  budget: BudgetGuard,
  progress: ProgressReporter,
  now: () => Date,
  exploreDeadline: number,
): Promise<AnalysisOutcome> {
  const { repos } = deps;
  const { snapshot, repoContext } = prepared;

  const exploration = await runExploration(
    {
      analysisId: analysis.id,
      snapshotId: snapshot.id,
      repo: repoContext,
      stack: snapshot.detectedStack,
      level: analysis.level,
      purpose: analysis.purpose,
      candidates: prepared.candidates,
      excluded: prepared.excluded,
      directories: prepared.directories,
      initialFiles: prepared.initialFiles,
      initialNotes: prepared.initialNotes,
    },
    {
      llm: deps.llm,
      github: deps.github,
      repos,
      budget,
      progress,
      decideModel: deps.models.decide,
      signal,
      deadline: exploreDeadline,
      now: () => now().getTime(),
      onFilesRead: prepared.ensureRepoAvailable,
    },
  );
  throwIfAborted(signal);

  await progress.update({ stage: "writing_manual" });
  const limitStop = isLimitStop(exploration.stopReason);
  const codeLimitations = [
    ...(prepared.treeTruncated ? [PARTIAL_MESSAGES.repo_too_large] : []),
    ...(limitStop && exploration.coverage.some((entry) => entry.status !== "covered")
      ? [PARTIAL_MESSAGES[exploration.stopReason as PartialReason]]
      : []),
  ];
  const written = await writeManual(
    {
      analysisId: analysis.id,
      repo: { ...repoContext, htmlUrl: `https://github.com/${repoContext.owner}/${repoContext.name}` },
      stack: snapshot.detectedStack,
      level: analysis.level,
      purpose: analysis.purpose,
      workingSet: exploration.workingSet,
      notes: exploration.notes,
      coverage: exploration.coverage,
      codeLimitations,
    },
    { llm: deps.llm, budget, progress, writeModel: deps.models.write, now },
  );

  await repos.manuals.insert({
    analysisId: analysis.id,
    level: analysis.level,
    purpose: analysis.purpose,
    document: written.manual,
    stats: written.stats,
    model: deps.models.write,
    usage: written.usage,
  });
  await repos.files.markIncludedInWrite(analysis.id, written.includedPaths);

  // ── 상태 판정 (data-model.md): 한도 때문에 부족한 섹션이 생겼을 때만 partial ──
  const partialReasons = new Set<PartialReason>();
  if (limitStop && written.manual.sections.some((section) => section.status !== "found")) {
    partialReasons.add(exploration.stopReason as PartialReason);
  }
  if (prepared.treeTruncated) partialReasons.add("repo_too_large");
  if (written.contentTrimmed) partialReasons.add("content_trimmed");

  const usage = budget.snapshot();
  return partialReasons.size > 0
    ? { status: "partial", stopReason: exploration.stopReason, partialReasons: [...partialReasons], usage }
    : { status: "completed", stopReason: exploration.stopReason, usage };
}
