import type { GitHubClient } from "./client.js";

// 저장소·ref별 최신 커밋을 5분간 메모리에 캐시한다 (T042, contracts/http-api.md /freshness).
// 결과 화면을 열 때마다 GitHub를 부르지 않도록 하고, 재생성(refresh_commit) 판단에도 같은 값을 쓴다.

export const FRESHNESS_TTL_MS = 5 * 60 * 1000;

export class FreshnessCache {
  private readonly entries = new Map<string, { sha: string; checkedAt: Date }>();

  constructor(
    private readonly github: Pick<GitHubClient, "getCommitSha">,
    private readonly options: { ttlMs?: number; now?: () => Date } = {},
  ) {}

  async latest(owner: string, name: string, ref: string): Promise<{ sha: string; checkedAt: Date }> {
    const key = `${owner.toLowerCase()}/${name.toLowerCase()}@${ref}`;
    const now = this.options.now?.() ?? new Date();
    const hit = this.entries.get(key);
    if (hit && now.getTime() - hit.checkedAt.getTime() < (this.options.ttlMs ?? FRESHNESS_TTL_MS)) return hit;
    const entry = { sha: await this.github.getCommitSha(owner, name, ref), checkedAt: now };
    this.entries.set(key, entry);
    return entry;
  }
}
