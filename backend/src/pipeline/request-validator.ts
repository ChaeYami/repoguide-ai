import type { RequestRejectReason } from "@repoguide/shared";
import type { Candidate, CoverageEntry, FileNote, RequestRecord } from "../db/json-types.js";
import type { ExclusionReason } from "../github/tree-filter.js";
import type { DecideOutput } from "../llm/schemas.js";

// Decide 출력의 코드 후처리 (contracts/llm-io.md §1, Constitution I·II·IV).
// LLM이 무엇을 요청하든 트리에 있고, 제외 대상이 아니고, 한도 안에 드는 파일만 읽는다.

export const MAX_EXPAND_DIRECTORIES = 5;
export const MAX_NOTE_SUMMARY_CHARS = 400;
export const MAX_FACTS_PER_NOTE = 8;

export interface RequestValidationInput {
  output: DecideOutput;
  candidates: ReadonlyMap<string, Candidate>;
  excluded: ReadonlyMap<string, ExclusionReason>;
  directories: ReadonlySet<string>;
  alreadyRead: ReadonlySet<string>;
  maxPerRound: number;
  remainingFiles: number;
  remainingGithubCalls: number;
  sectionIds: readonly string[];
  /** 이번 Decide에 원문으로 준 파일과 그 줄 수. 노트·사실의 라인 범위 검증 기준. */
  newFiles: ReadonlyMap<string, number>;
}

export interface AcceptedRequest {
  candidate: Candidate;
  reason: string;
}

export interface RequestValidationResult {
  accepted: AcceptedRequest[];
  records: RequestRecord[];
  expandDirectories: string[];
  coverage: CoverageEntry[];
  fileNotes: FileNote[];
}

export function normalizePath(path: string): string {
  return path.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "").replace(/\/{2,}/g, "/");
}

function rejectionFor(path: string, input: RequestValidationInput): RequestRejectReason | null {
  if (input.candidates.has(path)) return null;
  const asDirectory = path.replace(/\/+$/, "");
  if (input.directories.has(asDirectory)) return "not_a_file";
  const excluded = input.excluded.get(path);
  if (excluded) return excluded === "too_large" ? "too_large" : "excluded";
  return "not_in_tree";
}

export function validateDecideOutput(input: RequestValidationInput): RequestValidationResult {
  const accepted: AcceptedRequest[] = [];
  const records: RequestRecord[] = [];
  const acceptedPaths = new Set<string>();

  for (const request of input.output.requests) {
    const path = normalizePath(request.path);
    const reason = request.reason.trim();
    let rejectReason: RequestRejectReason | null = rejectionFor(path, input);
    if (!rejectReason && (input.alreadyRead.has(path) || acceptedPaths.has(path))) rejectReason = "already_read";
    if (!rejectReason && accepted.length >= input.maxPerRound) rejectReason = "over_round_limit";
    if (!rejectReason && accepted.length >= input.remainingFiles) rejectReason = "over_file_limit";
    if (!rejectReason && accepted.length >= input.remainingGithubCalls) rejectReason = "budget";

    records.push({ path, reason, accepted: rejectReason === null, rejectReason });
    if (rejectReason === null) {
      accepted.push({ candidate: input.candidates.get(path)!, reason });
      acceptedPaths.add(path);
    }
  }

  const expandDirectories = [
    ...new Set(input.output.expandDirectories.map((dir) => normalizePath(dir).replace(/\/+$/, ""))),
  ]
    .filter((dir) => input.directories.has(dir))
    .slice(0, MAX_EXPAND_DIRECTORIES);

  const coverage = input.sectionIds.map((sectionId) => {
    const entry = input.output.coverage.find((item) => item.sectionId === sectionId);
    return entry ? { sectionId, status: entry.status, note: entry.note } : { sectionId, status: "missing" as const, note: "" };
  });

  const fileNotes: FileNote[] = [];
  for (const note of input.output.fileNotes) {
    const path = normalizePath(note.path);
    const lineCount = input.newFiles.get(path);
    if (lineCount === undefined || fileNotes.some((existing) => existing.path === path)) continue;
    fileNotes.push({
      path,
      summary: note.summary.slice(0, MAX_NOTE_SUMMARY_CHARS),
      facts: note.facts
        .filter((fact) => fact.startLine >= 1 && fact.startLine <= fact.endLine && fact.endLine <= lineCount)
        .slice(0, MAX_FACTS_PER_NOTE),
    });
  }

  return { accepted, records, expandDirectories, coverage, fileNotes };
}
