// npm run dev:ingest -- <GitHub URL>
// 실제 GitHub에서 저장소 확인 → 커밋 고정 → 트리 수집·필터 → 시드 파일 읽기 → 스택 감지를 실행하고 요약을 출력한다.
// LLM과 DB는 쓰지 않는다. GITHUB_TOKEN이 없으면 시간당 60회 한도로 동작한다.
import { parseRepoUrl } from "@repoguide/shared";
import { EnvError, loadConfig } from "../src/config/env.js";
import { GitHubClient, GitHubError, type GitHubErrorCode } from "../src/github/client.js";
import { ingestRepository } from "../src/github/ingest.js";
import { buildTreeListing } from "../src/github/tree-listing.js";

const GITHUB_ERROR_HINTS: Record<GitHubErrorCode, string> = {
  repo_not_found_or_private: "저장소를 찾을 수 없거나 비공개 저장소입니다. 공개 저장소만 지원합니다.",
  repo_empty: "저장소에 커밋이 없습니다.",
  ref_not_found: "URL의 브랜치·태그를 찾을 수 없습니다.",
  github_rate_limited: "GitHub 사용량 제한에 걸렸습니다. GITHUB_TOKEN을 설정하면 한도가 시간당 5,000회로 늘어납니다.",
  github_unavailable: "GitHub가 응답하지 않습니다. 잠시 후 다시 시도해 주세요.",
  file_not_found: "파일을 찾을 수 없습니다.",
};

const PREVIEW_LINES = 15;

async function main() {
  const url = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
  if (!url) {
    console.error("사용법: npm run dev:ingest -- https://github.com/<owner>/<repo>");
    process.exitCode = 2;
    return;
  }

  const parsed = parseRepoUrl(url);
  if (!parsed.ok) {
    console.error(`✘ ${parsed.error.message} (예: ${parsed.error.example})`);
    process.exitCode = 2;
    return;
  }

  const { env, limits } = loadConfig();
  if (!env.GITHUB_TOKEN) {
    console.warn("⚠ GITHUB_TOKEN이 없어 시간당 60회 한도로 실행합니다 (quickstart 1.2 참고).\n");
  }

  let calls = 0;
  const client = new GitHubClient({ token: env.GITHUB_TOKEN, onCall: () => (calls += 1) });
  const started = Date.now();
  const result = await ingestRepository(client, parsed.value, {
    maxFileBytes: limits.maxFileBytes,
    maxCharsPerFile: limits.maxCharsPerFile,
  });

  const excludedByReason = result.filter.excluded.reduce<Record<string, number>>((acc, item) => {
    acc[item.reason] = (acc[item.reason] ?? 0) + 1;
    return acc;
  }, {});
  const listing = buildTreeListing(result.candidates, { maxEntries: 2_000 });

  console.log(`저장소      ${result.repo.owner}/${result.repo.name}  (${result.repo.htmlUrl})`);
  console.log(`설명        ${result.repo.description ?? "-"}`);
  console.log(`ref         ${result.ref}${result.ref === result.repo.defaultBranch ? " (기본 브랜치)" : ""}`);
  console.log(`커밋 SHA    ${result.commitSha}`);
  console.log(`하위 경로   ${result.subpath ?? "-"}`);
  console.log(`트리        항목 ${result.treeEntryCount}개, 읽기 후보 ${result.candidates.length}개${result.treeTruncated ? ", ⚠ GitHub 응답이 잘림(대형 저장소)" : ""}`);
  console.log(`제외        ${Object.entries(excludedByReason).map(([reason, count]) => `${reason} ${count}`).join(", ") || "없음"}`);
  console.log(`스택        언어 ${result.detectedStack.languages.join(", ") || "-"} | 패키지 관리 ${result.detectedStack.packageManagers.join(", ") || "-"} | 프레임워크 ${result.detectedStack.frameworkHints.join(", ") || "-"}`);
  console.log(`\n시드 파일 (${result.seeds.length}개)`);
  for (const seed of result.seeds) {
    const state = seed.skippedReason ? `건너뜀: ${seed.skippedReason}` : `${seed.lineCount}줄${seed.truncated ? ", 잘림" : ""}`;
    const firstLine = seed.content?.split("\n").find((line) => line.trim().length > 0)?.slice(0, 80) ?? "";
    console.log(`  - ${seed.path}  [${seed.rule}] ${state}${firstLine ? `  │ ${firstLine}` : ""}`);
  }
  console.log(`\n트리 목록 미리보기 (LLM 전달용 ${listing.lineCount}줄 중 ${Math.min(PREVIEW_LINES, listing.lineCount)}줄)`);
  for (const line of listing.text.split("\n").slice(0, PREVIEW_LINES)) console.log(`  ${line}`);
  console.log(`\nGitHub 호출 ${calls}회, 남은 한도 ${client.rateLimitRemaining ?? "?"}, ${Date.now() - started}ms`);
}

main().catch((error: unknown) => {
  if (error instanceof EnvError) {
    console.error(error.message);
  } else if (error instanceof GitHubError) {
    const retry = error.retryAfterSec ? ` (${error.retryAfterSec}초 후 재시도 가능)` : "";
    console.error(`✘ [${error.code}] ${GITHUB_ERROR_HINTS[error.code]}${retry}`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
