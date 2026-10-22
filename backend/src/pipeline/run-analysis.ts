import type { FailureCode, PartialReason, StopReason } from "@repoguide/shared";
import { PARTIAL_MESSAGES } from "../api/messages.js";
import type { Candidate } from "../db/json-types.js";
import type { AnalysisOutcome, AnalysisRow } from "../db/repositories/analyses.js";
import type { Repositories } from "../db/repositories/index.js";
import { GitHubError, type GitHubClient } from "../github/client.js";
import { resolveRepository } from "../github/resolve-ref.js";
import { selectSeeds } from "../github/seeds.js";
import { detectStack } from "../github/stack-detect.js";
import { filterTree } from "../github/tree-filter.js";
import { RunTimeoutError, type WorkerLogger } from "../jobs/worker.js";
import { LlmError, type LlmClient } from "../llm/client.js";
import { BudgetGuard } from "./budget.js";
import { runExploration, type WorkingFile } from "./explore-loop.js";
import { readFiles, type ReadFileResult } from "./file-reader.js";
import { parsedFromAnalysis } from "./new-analysis.js";
import { ProgressReporter } from "./progress.js";
import { ManualGenerationError, writeManual, WriteLimitError } from "./write-manual.js";

// 분석 오케스트레이터 (FR-006~FR-019, FR-028, data-model.md 상태 전이).
// validating_repo → scanning_structure → 탐색 루프 → writing_manual → done.

export type AnalysisGitHub = Pick<GitHubClient, "getRepo" | "getCommitSha" | "getTree" | "getFileRaw">;

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

const LIMIT_STOP_REASONS = new Set<StopReason>([
  "round_limit",
  "file_limit",
  "cost_limit",
  "token_limit",
  "github_call_limit",
  "timeout",
]);

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

async function execute(
  analysis: AnalysisRow,
  signal: AbortSignal,
  deps: Omit<RunDeps, "github"> & { github: AnalysisGitHub },
  budget: BudgetGuard,
  progress: ProgressReporter,
  now: () => Date,
): Promise<AnalysisOutcome> {
  const { repos, github } = deps;
  const { limits } = budget;

  // ── validating_repo: 공개 여부, ref 해석, 커밋 고정 ──
  await progress.update({ stage: "validating_repo" });
  const resolved = await resolveRepository(github, parsedFromAnalysis(analysis));
  const { repo, commitSha } = resolved;
  throwIfAborted(signal);

  // ── scanning_structure: 트리 수집·필터, 시드 읽기, 스택 감지, 스냅샷 ──
  await progress.update({ stage: "scanning_structure" });
  const tree = await github.getTree(repo.owner, repo.name, commitSha);
  const filter = filterTree(tree.entries, { maxFileBytes: limits.maxFileBytes });
  if (filter.candidates.length === 0) throw new NoAnalyzableFilesError();
  const directories = new Set(tree.entries.filter((entry) => entry.type === "tree").map((entry) => entry.path));
  const seedPlan = selectSeeds(filter.candidates, resolved.subpath);
  const byPath = new Map(filter.candidates.map((candidate) => [candidate.path, candidate]));
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
  } else {
    const fresh = await read(seedCandidates);
    const manifestContents = Object.fromEntries(
      seedPlan.flatMap((seed, index) =>
        seed.rule.includes("manifest") && fresh[index]?.content ? [[seed.path, fresh[index]!.content!]] : [],
      ),
    );
    snapshot = await repos.snapshots.upsert({
      owner: ownerKey,
      name: nameKey,
      commitSha,
      ref: resolved.ref,
      defaultBranch: repo.defaultBranch,
      description: repo.description,
      primaryLanguage: repo.language,
      treeEntryCount: tree.entries.length,
      candidateCount: filter.candidates.length,
      treeTruncated: tree.truncated,
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
  await repos.analyses.attachSnapshot(analysis.id, snapshot.id, resolved.subpath);
  budget.recordFilesRead(seedResults.length);
  await progress.update({ filesRead: seedResults.length, filesPlanned: seedResults.length });
  throwIfAborted(signal);

  const initialFiles: WorkingFile[] = seedResults.map((result, index) => ({
    ...result,
    snapshotFileId: result.snapshotFileId!,
    source: "seed",
    roundNo: 1,
    reason: seedPlan[index]!.rule,
  }));
  const repoContext = {
    owner: repo.owner,
    name: repo.name,
    description: repo.description,
    language: repo.language,
    ref: resolved.ref,
    commitSha,
    subpath: resolved.subpath,
  };

  // ── 탐색 루프 (Decide ↔ 읽기) ──
  const exploration = await runExploration(
    {
      analysisId: analysis.id,
      snapshotId: snapshot.id,
      repo: repoContext,
      stack: snapshot.detectedStack,
      level: analysis.level,
      purpose: analysis.purpose,
      candidates: filter.candidates,
      excluded: new Map(filter.excluded.map((item) => [item.path, item.reason])),
      directories,
      initialFiles,
    },
    { llm: deps.llm, github, repos, budget, progress, decideModel: deps.models.decide, signal },
  );
  throwIfAborted(signal);

  // ── writing_manual ──
  await progress.update({ stage: "writing_manual" });
  const limitStop = LIMIT_STOP_REASONS.has(exploration.stopReason);
  const codeLimitations = [
    ...(tree.truncated ? [PARTIAL_MESSAGES.repo_too_large] : []),
    ...(limitStop && exploration.coverage.some((entry) => entry.status !== "covered")
      ? [PARTIAL_MESSAGES[exploration.stopReason as PartialReason]]
      : []),
  ];
  const written = await writeManual(
    {
      analysisId: analysis.id,
      repo: { ...repoContext, htmlUrl: `https://github.com/${repo.owner}/${repo.name}` },
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
  if (tree.truncated) partialReasons.add("repo_too_large");
  if (written.contentTrimmed) partialReasons.add("content_trimmed");

  const usage = budget.snapshot();
  return partialReasons.size > 0
    ? { status: "partial", stopReason: exploration.stopReason, partialReasons: [...partialReasons], usage }
    : { status: "completed", stopReason: exploration.stopReason, usage };
}
