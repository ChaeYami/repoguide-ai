// GitHub REST 클라이언트 (research R6). 필요한 엔드포인트 4개만 다루고, 응답 상태를 도메인 오류 코드로 바꾼다.

export const GITHUB_API_VERSION = "2026-03-10";

export type GitHubErrorCode =
  | "repo_not_found_or_private"
  | "repo_empty"
  | "ref_not_found"
  | "github_rate_limited"
  | "github_unavailable"
  | "file_not_found";

export class GitHubError extends Error {
  constructor(
    readonly code: GitHubErrorCode,
    readonly detail: { status?: number; retryAfterSec?: number } = {},
  ) {
    super(`GitHub API error: ${code}${detail.status ? ` (HTTP ${detail.status})` : ""}`);
    this.name = "GitHubError";
  }

  get retryAfterSec(): number | undefined {
    return this.detail.retryAfterSec;
  }
}

export interface RepoInfo {
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  htmlUrl: string;
}

export interface TreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  mode: string;
  sha: string;
  size?: number;
}

export interface TreeResult {
  truncated: boolean;
  entries: TreeEntry[];
}

export interface GitHubCall {
  method: string;
  path: string;
  status: number | "network_error";
}

export interface GitHubClientOptions {
  token?: string;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  /** 재시도를 포함한 모든 실제 호출마다 불린다(BudgetGuard 집계용). */
  onCall?: (call: GitHubCall) => void;
  maxConcurrency?: number;
  baseUrl?: string;
}

interface StatusMapping {
  404?: GitHubErrorCode;
  403?: GitHubErrorCode;
  409?: GitHubErrorCode;
  422?: GitHubErrorCode;
}

const MAX_SERVER_RETRIES = 2;
const BACKOFF_MS = [500, 1500];
const MAX_SECONDARY_WAIT_SEC = 60;

const encodePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");

class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

export class GitHubClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly semaphore: Semaphore;
  private readonly baseUrl: string;
  /** 마지막으로 확인한 남은 호출 수 (x-ratelimit-remaining) */
  rateLimitRemaining: number | null = null;

  constructor(private readonly options: GitHubClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
    this.semaphore = new Semaphore(options.maxConcurrency ?? 6);
    this.baseUrl = options.baseUrl ?? "https://api.github.com";
  }

  get authenticated(): boolean {
    return Boolean(this.options.token);
  }

  async getRepo(owner: string, name: string): Promise<RepoInfo> {
    const res = await this.request(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
      accept: "application/vnd.github+json",
      map: { 404: "repo_not_found_or_private", 403: "repo_not_found_or_private" },
    });
    const body = (await res.json()) as {
      name: string;
      owner: { login: string };
      private: boolean;
      default_branch: string;
      description: string | null;
      language: string | null;
      html_url: string;
    };
    // 공개 저장소만 지원한다(FR-006). 공개 읽기 전용 토큰이면 비공개 저장소는 애초에 404다.
    if (body.private) throw new GitHubError("repo_not_found_or_private", { status: res.status });
    return {
      owner: body.owner.login,
      name: body.name,
      private: body.private,
      defaultBranch: body.default_branch,
      description: body.description,
      language: body.language,
      htmlUrl: body.html_url,
    };
  }

  /** ref(브랜치·태그·SHA)를 커밋 SHA로 고정한다. */
  async getCommitSha(owner: string, name: string, ref: string): Promise<string> {
    const res = await this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/commits/${encodePath(ref)}`,
      {
        accept: "application/vnd.github.sha",
        map: { 404: "ref_not_found", 422: "ref_not_found", 409: "repo_empty" },
      },
    );
    return (await res.text()).trim();
  }

  async getTree(owner: string, name: string, sha: string): Promise<TreeResult> {
    const res = await this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/git/trees/${encodeURIComponent(sha)}?recursive=1`,
      {
        accept: "application/vnd.github+json",
        map: { 404: "ref_not_found", 422: "ref_not_found", 409: "repo_empty" },
      },
    );
    const body = (await res.json()) as { truncated: boolean; tree: TreeEntry[] };
    return {
      truncated: body.truncated,
      entries: body.tree.map(({ path, type, mode, sha: entrySha, size }) => ({
        path,
        type,
        mode,
        sha: entrySha,
        ...(size === undefined ? {} : { size }),
      })),
    };
  }

  async getFileRaw(owner: string, name: string, path: string, sha: string): Promise<Uint8Array> {
    const res = await this.request(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents/${encodePath(path)}?ref=${encodeURIComponent(sha)}`,
      { accept: "application/vnd.github.raw+json", map: { 404: "file_not_found" } },
    );
    return new Uint8Array(await res.arrayBuffer());
  }

  private async request(path: string, opts: { accept: string; map: StatusMapping }): Promise<Response> {
    return this.semaphore.run(async () => {
      let serverRetries = 0;
      let waitedForSecondary = false;

      for (;;) {
        let res: Response;
        try {
          res = await this.fetchImpl(`${this.baseUrl}${path}`, { headers: this.headers(opts.accept) });
        } catch {
          this.options.onCall?.({ method: "GET", path, status: "network_error" });
          if (serverRetries < MAX_SERVER_RETRIES) {
            await this.sleep(BACKOFF_MS[serverRetries++]!);
            continue;
          }
          throw new GitHubError("github_unavailable");
        }
        this.options.onCall?.({ method: "GET", path, status: res.status });

        const remaining = res.headers.get("x-ratelimit-remaining");
        if (remaining !== null) this.rateLimitRemaining = Number(remaining);
        if (res.ok) return res;

        if (res.status === 403 || res.status === 429) {
          const rate = await this.rateLimitInfo(res, remaining);
          if (rate) {
            if (rate.secondary && !waitedForSecondary && rate.retryAfterSec <= MAX_SECONDARY_WAIT_SEC) {
              waitedForSecondary = true;
              await this.sleep(rate.retryAfterSec * 1000);
              continue;
            }
            throw new GitHubError("github_rate_limited", { status: res.status, retryAfterSec: rate.retryAfterSec });
          }
        }

        const mapped = opts.map[res.status as keyof StatusMapping];
        if (mapped) throw new GitHubError(mapped, { status: res.status });

        if (res.status >= 500 && serverRetries < MAX_SERVER_RETRIES) {
          await this.sleep(BACKOFF_MS[serverRetries++]!);
          continue;
        }
        throw new GitHubError("github_unavailable", { status: res.status });
      }
    });
  }

  /** 403/429가 한도 초과인지 판단한다. 1차 한도는 남은 횟수 0, 2차 한도는 retry-after 또는 본문 문구로 알린다. */
  private async rateLimitInfo(
    res: Response,
    remaining: string | null,
  ): Promise<{ secondary: boolean; retryAfterSec: number } | null> {
    if (remaining === "0") {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const retryAfterSec = Number.isFinite(reset) ? Math.max(1, Math.ceil(reset - this.now() / 1000)) : 60;
      return { secondary: false, retryAfterSec };
    }
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter !== null) return { secondary: true, retryAfterSec: Math.max(1, Number(retryAfter) || 60) };
    const body = await res.clone().text().catch(() => "");
    if (/secondary rate limit|rate limit exceeded/i.test(body)) return { secondary: true, retryAfterSec: 60 };
    return null;
  }

  private headers(accept: string): Record<string, string> {
    return {
      Accept: accept,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "repoguide-ai",
      ...(this.options.token ? { Authorization: `Bearer ${this.options.token}` } : {}),
    };
  }
}
