import type { DetectedStack, FileSource, Level, Purpose, StopReason, Usage } from "@repoguide/shared";
import { sectionIdsFor } from "@repoguide/shared";
import { priceFor } from "../config/pricing.js";
import type { Candidate, CoverageEntry, FileNote, RequestRecord } from "../db/json-types.js";
import type { Repositories } from "../db/repositories/index.js";
import type { GitHubClient } from "../github/client.js";
import { buildTreeListing } from "../github/tree-listing.js";
import type { ExclusionReason } from "../github/tree-filter.js";
import { LlmError, type LlmClient, type LlmUsage } from "../llm/client.js";
import { estimateCall } from "../llm/cost.js";
import type { RepoContext } from "../llm/prompts/context.js";
import { buildDecidePrompt } from "../llm/prompts/decide.js";
import { decideOutputSchema, type DecideOutput } from "../llm/schemas.js";
import type { BudgetGuard } from "./budget.js";
import { type ReadFileResult, readFiles, type SkippedReason } from "./file-reader.js";
import type { ProgressReporter } from "./progress.js";
import { validateDecideOutput } from "./request-validator.js";

// 조건부 추가 탐색 루프 (research R1·R2, FR-007~FR-014).
// Decide #k → 코드 검증 → k라운드 읽기를 반복하고, 충분·후보 없음·한도 도달 시 멈춘다.
// 원문은 Decide에 한 번만 보여 주고, 이후에는 Decide가 남긴 파일 노트를 누적해 전달한다.

export const DECIDE_THINKING_LEVEL = "low" as const;
const TREE_LISTING_MAX_ENTRIES = 2_000;

export interface WorkingFile {
  path: string;
  sizeBytes: number;
  content: string | null;
  lineCount: number;
  truncated: boolean;
  skippedReason: SkippedReason | null;
  snapshotFileId: string;
  source: FileSource;
  roundNo: number;
  reason: string;
}

export interface ExploreInput {
  analysisId: string;
  snapshotId: string;
  repo: RepoContext;
  stack: DetectedStack;
  level: Level;
  purpose: Purpose;
  candidates: readonly Candidate[];
  excluded: ReadonlyMap<string, ExclusionReason>;
  directories: ReadonlySet<string>;
  /** 이미 읽은 파일: 시드(1라운드) 또는 재생성 시 재사용 파일(0라운드) */
  initialFiles: WorkingFile[];
  initialNotes?: FileNote[];
}

export interface ExploreDeps {
  llm: LlmClient;
  github: Pick<GitHubClient, "getFileRaw">;
  repos: Pick<Repositories, "rounds" | "files">;
  budget: BudgetGuard;
  progress: ProgressReporter;
  decideModel: string;
  signal?: AbortSignal;
  /** 이 시각(epoch ms)이 지나면 탐색을 멈추고 timeout으로 끝낸다. 남은 시간은 매뉴얼 작성 몫이다. */
  deadline?: number;
  now?: () => number;
  /** 라운드마다 읽은 결과를 넘긴다(분석 도중 저장소 삭제 감지 등). 예외를 던지면 분석이 실패한다. */
  onFilesRead?: (results: readonly ReadFileResult[]) => Promise<void>;
}

export interface ExploreResult {
  workingSet: WorkingFile[];
  notes: FileNote[];
  coverage: CoverageEntry[];
  stopReason: StopReason;
}

const NO_DECISION: DecideOutput = { fileNotes: [], coverage: [], sufficient: false, requests: [], expandDirectories: [] };

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw signal.reason ?? new Error("aborted");
}

/** 요청이 전부 한도 때문에 거절됐다면 그 한도를 종료 사유로 쓴다. */
function stopReasonFromRejections(records: RequestRecord[]): StopReason | null {
  if (records.some((record) => record.rejectReason === "over_file_limit")) return "file_limit";
  if (records.some((record) => record.rejectReason === "budget")) return "github_call_limit";
  return null;
}

function roundUsage(usage: LlmUsage, costUsd: number): Usage {
  return { rounds: 0, filesRead: 0, githubCalls: 0, ...usage, costUsd };
}

export async function runExploration(input: ExploreInput, deps: ExploreDeps): Promise<ExploreResult> {
  const { budget, progress, repos } = deps;
  const { limits } = budget;
  const candidatesByPath = new Map(input.candidates.map((candidate) => [candidate.path, candidate]));
  const schema = decideOutputSchema(input.purpose);

  const working: WorkingFile[] = [];
  const notes: FileNote[] = [...(input.initialNotes ?? [])];
  const expanded: string[] = [];
  let coverage: CoverageEntry[] = [];
  let stopReason: StopReason | null = null;

  const record = async (file: WorkingFile) => {
    working.push(file);
    await repos.files.addExploredFile({
      analysisId: input.analysisId,
      snapshotFileId: file.snapshotFileId,
      path: file.path,
      roundNo: file.roundNo,
      source: file.source,
      reason: file.reason,
    });
  };

  for (const file of input.initialFiles) await record(file);
  // 시드는 이미 읽었으므로 원문을 Decide #1에 바로 보여 준다. 원문을 못 본 채 판단하면 같은 시드를 다시 요청하기 쉽다.
  // 재사용 파일은 부모 분석의 노트가 이미 있다.
  let pending = input.initialFiles.filter((file) => file.content !== null && file.source !== "reused");

  const now = deps.now ?? Date.now;
  const pastDeadline = () => deps.deadline !== undefined && now() >= deps.deadline;

  for (let decideNo = 1; decideNo <= limits.maxRounds; decideNo += 1) {
    throwIfAborted(deps.signal);
    if (pastDeadline()) {
      stopReason = "timeout";
      break;
    }
    const stage = decideNo === 1 ? "selecting_files" : decideNo === 2 ? "reading_files" : "exploring_more";
    const newFiles = pending;
    pending = [];

    const listing = buildTreeListing(input.candidates, { maxEntries: TREE_LISTING_MAX_ENTRIES, expanded });
    const prompt = buildDecidePrompt({
      repo: input.repo,
      stack: input.stack,
      level: input.level,
      purpose: input.purpose,
      decideNo,
      treeListing: listing.text,
      collapsedDirectories: listing.collapsedDirectories,
      alreadyRead: working.map((file) => file.path),
      notes,
      newFiles: newFiles.map((file) => ({ path: file.path, content: file.content ?? "", truncated: file.truncated })),
      remaining: {
        rounds: limits.maxRounds - budget.snapshot().rounds,
        files: budget.remainingFiles(),
        perRound: limits.maxFilesPerRound,
      },
    });

    const estimate = estimateCall(priceFor(deps.decideModel), {
      text: prompt.systemInstruction + prompt.input,
      maxOutputTokens: limits.maxOutputDecide,
      thinkingLevel: DECIDE_THINKING_LEVEL,
    });
    const allowed = budget.canCallLlm(estimate);
    if (!allowed.ok) {
      stopReason = allowed.reason;
      break;
    }

    await progress.update({ stage, round: decideNo });
    let output = NO_DECISION;
    let usage: LlmUsage;
    let invalidOutput = false;
    let cost = 0;
    try {
      const result = await progress.withActivity("llm_deciding", () =>
        deps.llm.generateStructured({
          role: "decide",
          model: deps.decideModel,
          ...prompt,
          schema,
          maxOutputTokens: limits.maxOutputDecide,
          thinkingLevel: DECIDE_THINKING_LEVEL,
        }),
      );
      output = result.data;
      usage = result.usage;
    } catch (error) {
      if (!(error instanceof LlmError)) throw error;
      usage = error.usage;
      cost = budget.recordLlm(deps.decideModel, usage);
      if (error.code !== "llm_invalid_output") throw error;
      // 형식이 끝내 틀리면 "요청 없음, 불충분"으로 처리한다 (contracts/llm-io.md 공통 규칙).
      invalidOutput = true;
    }
    if (!invalidOutput) cost = budget.recordLlm(deps.decideModel, usage);

    const validation = validateDecideOutput({
      output,
      candidates: candidatesByPath,
      excluded: input.excluded,
      directories: input.directories,
      alreadyRead: new Set(working.map((file) => file.path)),
      maxPerRound: limits.maxFilesPerRound,
      remainingFiles: budget.remainingFiles(),
      remainingGithubCalls: budget.remainingGithubCalls(),
      sectionIds: sectionIdsFor(input.purpose),
      newFiles: new Map(newFiles.map((file) => [file.path, file.lineCount])),
    });
    notes.push(...validation.fileNotes);
    coverage = validation.coverage;

    await repos.rounds.insert({
      analysisId: input.analysisId,
      decideNo,
      model: deps.decideModel,
      inputFilePaths: newFiles.map((file) => file.path),
      requests: validation.records,
      expandedDirectories: validation.expandDirectories,
      coverage,
      fileNotes: validation.fileNotes,
      sufficient: output.sufficient,
      usage: roundUsage(usage, cost),
    });

    if (output.sufficient) {
      stopReason = "sufficient";
      break;
    }
    if (validation.accepted.length === 0 && validation.expandDirectories.length === 0) {
      stopReason = (!invalidOutput && stopReasonFromRejections(validation.records)) || "no_more_candidates";
      break;
    }
    expanded.push(...validation.expandDirectories);

    const roundAllowed = budget.canStartRound();
    if (!roundAllowed.ok) {
      stopReason = roundAllowed.reason;
      break;
    }
    if (pastDeadline()) {
      stopReason = "timeout";
      break;
    }
    throwIfAborted(deps.signal);
    await progress.update({
      stage: decideNo === 1 ? "reading_files" : "exploring_more",
      filesPlanned: working.length + validation.accepted.length,
    });
    const before = working.length;
    const results = await progress.withActivity("reading_files", () =>
      readFiles({
        client: deps.github,
        owner: input.repo.owner,
        name: input.repo.name,
        commitSha: input.repo.commitSha,
        files: validation.accepted.map((request) => request.candidate),
        maxCharsPerFile: limits.maxCharsPerFile,
        cache: { snapshotId: input.snapshotId, store: repos.files },
        onProgress: (done) => {
          progress.update({ filesRead: before + done }).catch(() => {});
        },
      }),
    );
    budget.recordRound();
    budget.recordFilesRead(results.length);
    await deps.onFilesRead?.(results);

    for (const [index, result] of results.entries()) {
      const file: WorkingFile = {
        ...result,
        snapshotFileId: result.snapshotFileId!,
        source: "llm_request",
        roundNo: decideNo,
        reason: validation.accepted[index]!.reason,
      };
      await record(file);
      if (file.content !== null) pending.push(file);
    }
    await progress.update({ filesRead: working.length });
    if (decideNo === limits.maxRounds) stopReason = "round_limit";
  }

  return { workingSet: working, notes, coverage, stopReason: stopReason ?? "round_limit" };
}
