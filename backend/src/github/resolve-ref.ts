import type { ParsedRepoUrl } from "@repoguide/shared";
import { GitHubError, type GitHubClient, type RepoInfo } from "./client.js";

// URL을 저장소·ref·고정 커밋·하위 경로로 확정한다 (FR-017, research R6).
// "/tree/a/b/c"는 브랜치 이름에 "/"가 들어갈 수 있어 a → a/b → a/b/c 순으로 최대 3번 커밋 조회를 시도한다.

const MAX_REF_ATTEMPTS = 3;

export interface ResolvedRepository {
  repo: RepoInfo;
  ref: string;
  commitSha: string;
  subpath: string | null;
}

type RefClient = Pick<GitHubClient, "getRepo" | "getCommitSha">;

export async function resolveRepository(client: RefClient, parsed: ParsedRepoUrl): Promise<ResolvedRepository> {
  const repo = await client.getRepo(parsed.owner, parsed.name);

  if (parsed.kind === "repo") {
    const commitSha = await client.getCommitSha(repo.owner, repo.name, repo.defaultBranch);
    return { repo, ref: repo.defaultBranch, commitSha, subpath: null };
  }

  const attempts = Math.min(MAX_REF_ATTEMPTS, parsed.segments.length);
  for (let take = 1; take <= attempts; take += 1) {
    const ref = parsed.segments.slice(0, take).join("/");
    try {
      const commitSha = await client.getCommitSha(repo.owner, repo.name, ref);
      return { repo, ref, commitSha, subpath: subpathOf(parsed, parsed.segments.slice(take)) };
    } catch (error) {
      if (error instanceof GitHubError && error.code === "ref_not_found") continue;
      throw error;
    }
  }
  throw new GitHubError("ref_not_found");
}

/** tree는 남은 경로 그대로, blob은 파일이 있는 디렉터리를 우선 탐색 범위로 쓴다. */
function subpathOf(parsed: ParsedRepoUrl, rest: string[]): string | null {
  const parts = parsed.kind === "blob" ? rest.slice(0, -1) : rest;
  return parts.length > 0 ? parts.join("/") : null;
}
