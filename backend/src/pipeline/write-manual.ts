import type { DetectedStack, Level, Manual, Purpose, Usage } from "@repoguide/shared";
import { PARTIAL_MESSAGES } from "../api/messages.js";
import { priceFor } from "../config/pricing.js";
import type { CoverageEntry, FileNote, ManualStats } from "../db/json-types.js";
import { LlmError, type LlmClient, type LlmUsage } from "../llm/client.js";
import { estimateCall } from "../llm/cost.js";
import type { RepoContext } from "../llm/prompts/context.js";
import { PROMPT_VERSION } from "../llm/prompts/file-block.js";
import { buildWritePrompt } from "../llm/prompts/write.js";
import { writeOutputSchema } from "../llm/schemas.js";
import type { BudgetGuard } from "./budget.js";
import type { WorkingFile } from "./explore-loop.js";
import { assembleManual } from "./manual-assembler.js";
import type { ProgressReporter } from "./progress.js";

// Write 입력 구성과 매뉴얼 생성 (contracts/llm-io.md §2, FR-020~FR-023, Constitution VI).

export const WRITE_THINKING_LEVEL = "low" as const;
export const MIN_WRITE_OUTPUT_TOKENS = 4_000;

/** 비용·토큰 상한 안에서 Write를 호출할 방법이 없을 때 → failed(limit_reached) */
export class WriteLimitError extends Error {
  constructor() {
    super("write call does not fit the remaining budget");
    this.name = "WriteLimitError";
  }
}

/** Write 출력이 끝내 스키마를 따르지 않을 때 → failed(manual_generation_failed) */
export class ManualGenerationError extends Error {
  constructor(detail: string) {
    super(`manual generation failed: ${detail}`);
    this.name = "ManualGenerationError";
  }
}

export interface WriteInput {
  analysisId: string;
  repo: RepoContext & { htmlUrl: string };
  stack: DetectedStack;
  level: Level;
  purpose: Purpose;
  workingSet: readonly WorkingFile[];
  notes: readonly FileNote[];
  coverage: readonly CoverageEntry[];
  /** 코드가 판정한 한계(고정 문구) */
  codeLimitations: string[];
}

export interface WriteDeps {
  llm: LlmClient;
  budget: BudgetGuard;
  progress: ProgressReporter;
  writeModel: string;
  now?: () => Date;
}

export interface WriteResult {
  manual: Manual;
  stats: ManualStats;
  usage: Usage;
  includedPaths: string[];
  contentTrimmed: boolean;
}

/** 원문 우선순위: 시드 → 노트에 사실이 남은 파일 → 나중 라운드에 요청된 파일 → 그 외 */
export function prioritize(files: readonly WorkingFile[], notes: readonly FileNote[]): WorkingFile[] {
  const withFacts = new Set(notes.filter((note) => note.facts.length > 0).map((note) => note.path));
  const tier = (file: WorkingFile) =>
    file.source === "seed" ? 0 : withFacts.has(file.path) ? 1 : file.source === "llm_request" ? 2 : 3;
  return files
    .map((file, index) => ({ file, index }))
    .sort((a, b) => tier(a.file) - tier(b.file) || (tier(a.file) === 2 ? b.file.roundNo - a.file.roundNo : 0) || a.index - b.index)
    .map(({ file }) => file);
}

/** 원문 총량 상한 안에 들어가는 파일을 우선순위대로 고른다. */
export function selectWithinContentLimit(ordered: readonly WorkingFile[], maxContentChars: number): WorkingFile[] {
  const selected: WorkingFile[] = [];
  let total = 0;
  for (const file of ordered) {
    const size = file.content?.length ?? 0;
    if (total + size > maxContentChars) continue;
    selected.push(file);
    total += size;
  }
  return selected;
}

export async function writeManual(input: WriteInput, deps: WriteDeps): Promise<WriteResult> {
  const { budget, progress } = deps;
  const { limits } = budget;
  const readable = input.workingSet.filter((file) => file.content !== null);
  let included = selectWithinContentLimit(prioritize(readable, input.notes), limits.maxContentChars);
  let maxOutput = limits.maxOutputWrite;

  const promptFor = (files: WorkingFile[], trimmed: boolean) => {
    const includedPaths = new Set(files.map((file) => file.path));
    const limitations = [...input.codeLimitations, ...(trimmed ? [PARTIAL_MESSAGES.content_trimmed] : [])];
    return {
      limitations,
      prompt: buildWritePrompt({
        repo: input.repo,
        stack: input.stack,
        level: input.level,
        purpose: input.purpose,
        files: files.map((file) => ({ path: file.path, content: file.content!, truncated: file.truncated })),
        noteOnlyFiles: input.notes.filter((note) => !includedPaths.has(note.path)),
        coverage: [...input.coverage],
        limitations,
      }),
    };
  };

  // 예산 안에 들어올 때까지 낮은 우선순위 원문부터 빼고, 그다음 출력 상한을 줄인다 (research R5).
  for (;;) {
    const trimmed = included.length < readable.length;
    const { prompt } = promptFor(included, trimmed);
    const estimate = estimateCall(priceFor(deps.writeModel), {
      text: prompt.systemInstruction + prompt.input,
      maxOutputTokens: maxOutput,
      thinkingLevel: WRITE_THINKING_LEVEL,
    });
    if (budget.canCallLlm(estimate).ok) break;
    if (included.length > 0) included = included.slice(0, -1);
    else if (maxOutput > MIN_WRITE_OUTPUT_TOKENS) maxOutput = Math.max(MIN_WRITE_OUTPUT_TOKENS, Math.floor(maxOutput / 2));
    else throw new WriteLimitError();
  }

  const contentTrimmed = included.length < readable.length;
  const { prompt, limitations } = promptFor(included, contentTrimmed);
  let usage: LlmUsage;
  let output;
  try {
    const result = await progress.withActivity("llm_writing", () =>
      deps.llm.generateStructured({
        role: "write",
        model: deps.writeModel,
        ...prompt,
        schema: writeOutputSchema(input.purpose),
        maxOutputTokens: maxOutput,
        thinkingLevel: WRITE_THINKING_LEVEL,
      }),
    );
    output = result.data;
    usage = result.usage;
  } catch (error) {
    if (!(error instanceof LlmError)) throw error;
    budget.recordLlm(deps.writeModel, error.usage);
    if (error.code === "llm_invalid_output") throw new ManualGenerationError(error.message);
    throw error;
  }
  const cost = budget.recordLlm(deps.writeModel, usage);

  await progress.update({ activity: "validating_citations" });
  const { manual, stats } = assembleManual({
    output,
    analysisId: input.analysisId,
    level: input.level,
    purpose: input.purpose,
    repo: {
      owner: input.repo.owner,
      name: input.repo.name,
      ref: input.repo.ref,
      commitSha: input.repo.commitSha,
      htmlUrl: input.repo.htmlUrl,
    },
    // 근거는 이번 실행에서 원문을 확보한 작업 집합 파일이면 인정한다(R8 규칙 1).
    sources: new Map(readable.map((file) => [file.path, file.lineCount])),
    codeLimitations: limitations,
    model: deps.writeModel,
    promptVersion: PROMPT_VERSION,
    generatedAt: deps.now?.() ?? new Date(),
  });
  await progress.update({ activity: null });

  return {
    manual,
    stats,
    usage: { rounds: 0, filesRead: 0, githubCalls: 0, ...usage, costUsd: cost },
    includedPaths: included.map((file) => file.path),
    contentTrimmed,
  };
}
