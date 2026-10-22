import type { Level, ParsedRepoUrl, Purpose } from "@repoguide/shared";
import type { Limits } from "../config/limits.js";
import type { AnalysisRow, NewAnalysis } from "../db/repositories/analyses.js";
import { PROMPT_VERSION } from "../llm/prompts/file-block.js";

// URL ↔ 분석 요청 변환. API(POST /api/analyses)와 dev:analyze가 같은 규칙을 쓴다.
// ref와 하위 경로는 분석 시점에 GitHub로 확정하므로, 요청에는 "/tree/" 뒤 세그먼트를 그대로 둔다.
// blob URL은 파일 이름을 빼고 그 디렉터리를 가리키는 tree URL처럼 다룬다.

export function analysisFromUrl(
  parsed: ParsedRepoUrl,
  options: { level: Level; purpose: Purpose; limits: Limits; clientKeyHash: string; retentionDays: number; now?: Date },
): NewAnalysis {
  const segments = parsed.kind === "blob" ? parsed.segments.slice(0, -1) : parsed.segments;
  const now = options.now ?? new Date();
  return {
    repoOwner: parsed.owner,
    repoName: parsed.name,
    requestedRef: segments.length > 0 ? segments.join("/") : null,
    subpath: null,
    level: options.level,
    purpose: options.purpose,
    limits: options.limits,
    promptVersion: PROMPT_VERSION,
    clientKeyHash: options.clientKeyHash,
    expiresAt: new Date(now.getTime() + options.retentionDays * 24 * 60 * 60 * 1000),
  };
}

export function parsedFromAnalysis(row: Pick<AnalysisRow, "repoOwner" | "repoName" | "requestedRef">): ParsedRepoUrl {
  const segments = row.requestedRef ? row.requestedRef.split("/") : [];
  return {
    owner: row.repoOwner,
    name: row.repoName,
    kind: segments.length > 0 ? "tree" : "repo",
    segments,
    htmlUrl: `https://github.com/${row.repoOwner}/${row.repoName}`,
  };
}
