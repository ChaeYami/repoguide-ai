import { describe, expect, it } from "vitest";
import { GITHUB_API_VERSION, GitHubClient, GitHubError } from "../../src/github/client.js";
import { createFakeFetch, type FakeRoute, repoBody } from "../support/fake-fetch.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const NOW_MS = 1_800_000_000_000;

function client(routes: FakeRoute[], opts: { token?: string; delayMs?: number } = {}) {
  const fake = createFakeFetch(routes, { delayMs: opts.delayMs });
  const sleeps: number[] = [];
  const calls: unknown[] = [];
  const gh = new GitHubClient({
    token: opts.token,
    fetch: fake.fetch,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    now: () => NOW_MS,
    onCall: (call) => calls.push(call),
  });
  return { gh, fake, sleeps, calls };
}

async function errorOf(promise: Promise<unknown>): Promise<GitHubError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GitHubError) return error;
    throw error;
  }
  throw new Error("GitHubError가 발생하지 않았습니다");
}

describe("GitHubClient.getRepo", () => {
  it("maps repository metadata and sends the documented headers", async () => {
    const { gh, fake } = client([{ match: /\/repos\/acme\/app$/, responses: [{ body: repoBody() }] }], {
      token: "github_pat_test",
    });
    await expect(gh.getRepo("acme", "app")).resolves.toEqual({
      owner: "acme",
      name: "app",
      private: false,
      defaultBranch: "main",
      description: "Demo app",
      language: "TypeScript",
      htmlUrl: "https://github.com/acme/app",
    });
    expect(fake.calls[0]!.headers).toMatchObject({
      Authorization: "Bearer github_pat_test",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": "repoguide-ai",
    });
  });

  it("omits Authorization when no token is configured", async () => {
    const { gh, fake } = client([{ match: /\/repos\/acme\/app$/, responses: [{ body: repoBody() }] }]);
    await gh.getRepo("acme", "app");
    expect(fake.calls[0]!.headers).not.toHaveProperty("Authorization");
  });

  it.each([404, 403])("maps HTTP %i to repo_not_found_or_private", async (status) => {
    const { gh } = client([{ match: /\/repos\//, responses: [{ status, body: { message: "Not Found" } }] }]);
    expect((await errorOf(gh.getRepo("acme", "secret"))).code).toBe("repo_not_found_or_private");
  });

  it("refuses private repositories even if the token can see them", async () => {
    const { gh } = client([{ match: /\/repos\//, responses: [{ body: repoBody({ private: true }) }] }]);
    expect((await errorOf(gh.getRepo("acme", "app"))).code).toBe("repo_not_found_or_private");
  });
});

describe("GitHubClient.getCommitSha", () => {
  it("returns the SHA and keeps slashes in branch names", async () => {
    const { gh, fake } = client([{ match: /\/commits\//, responses: [{ body: `${SHA}\n` }] }]);
    await expect(gh.getCommitSha("acme", "app", "feature/login form")).resolves.toBe(SHA);
    expect(fake.calls[0]!.url).toContain("/commits/feature/login%20form");
    expect(fake.calls[0]!.headers.Accept).toBe("application/vnd.github.sha");
  });

  it.each([
    [404, "ref_not_found"],
    [422, "ref_not_found"],
    [409, "repo_empty"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const { gh } = client([{ match: /\/commits\//, responses: [{ status, body: { message: "x" } }] }]);
    expect((await errorOf(gh.getCommitSha("acme", "app", "nope"))).code).toBe(code);
  });
});

describe("rate limits and retries", () => {
  it("fails fast on the primary rate limit with a retry time from x-ratelimit-reset", async () => {
    const resetSec = NOW_MS / 1000 + 1200;
    const { gh, sleeps } = client([
      {
        match: /\/repos\//,
        responses: [
          {
            status: 403,
            body: { message: "API rate limit exceeded" },
            headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": String(resetSec) },
          },
        ],
      },
    ]);
    const error = await errorOf(gh.getRepo("acme", "app"));
    expect(error.code).toBe("github_rate_limited");
    expect(error.retryAfterSec).toBe(1200);
    expect(sleeps).toEqual([]);
  });

  it("waits once for a secondary rate limit and then succeeds", async () => {
    const { gh, sleeps, calls } = client([
      {
        match: /\/repos\//,
        responses: [
          { status: 429, body: { message: "secondary rate limit" }, headers: { "retry-after": "3" } },
          { body: repoBody() },
        ],
      },
    ]);
    await expect(gh.getRepo("acme", "app")).resolves.toMatchObject({ name: "app" });
    expect(sleeps).toEqual([3000]);
    expect(calls).toHaveLength(2);
  });

  it("gives up after the second secondary rate limit", async () => {
    const limited = { status: 403, body: { message: "You have exceeded a secondary rate limit" }, headers: { "retry-after": "5" } };
    const { gh } = client([{ match: /\/repos\//, responses: [limited, limited] }]);
    const error = await errorOf(gh.getRepo("acme", "app"));
    expect(error.code).toBe("github_rate_limited");
    expect(error.retryAfterSec).toBe(5);
  });

  it("retries server errors with backoff and recovers", async () => {
    const { gh, sleeps } = client([
      { match: /\/repos\//, responses: [{ status: 502 }, { status: 503 }, { body: repoBody() }] },
    ]);
    await expect(gh.getRepo("acme", "app")).resolves.toMatchObject({ name: "app" });
    expect(sleeps).toEqual([500, 1500]);
  });

  it("reports github_unavailable after repeated server or network errors", async () => {
    const server = client([{ match: /\/repos\//, responses: [{ status: 500 }] }]);
    expect((await errorOf(server.gh.getRepo("acme", "app"))).code).toBe("github_unavailable");
    expect(server.calls).toHaveLength(3);

    const network = client([{ match: /\/repos\//, responses: ["network_error"] }]);
    expect((await errorOf(network.gh.getRepo("acme", "app"))).code).toBe("github_unavailable");
  });
});

describe("tree and file content", () => {
  it("returns tree entries and the truncated flag", async () => {
    const { gh, fake } = client([
      {
        match: /\/git\/trees\//,
        responses: [
          {
            body: {
              truncated: true,
              tree: [
                { path: "src", type: "tree", mode: "040000", sha: "t1" },
                { path: "src/index.ts", type: "blob", mode: "100644", sha: "b1", size: 120 },
              ],
            },
          },
        ],
      },
    ]);
    await expect(gh.getTree("acme", "app", SHA)).resolves.toEqual({
      truncated: true,
      entries: [
        { path: "src", type: "tree", mode: "040000", sha: "t1" },
        { path: "src/index.ts", type: "blob", mode: "100644", sha: "b1", size: 120 },
      ],
    });
    expect(fake.calls[0]!.url).toContain(`/git/trees/${SHA}?recursive=1`);
  });

  it("downloads raw bytes pinned to the commit and maps 404 to file_not_found", async () => {
    const { gh, fake } = client([
      { match: /contents\/docs\/read%20me\.md/, responses: [{ body: "hello" }] },
      { match: /contents\//, responses: [{ status: 404, body: { message: "Not Found" } }] },
    ]);
    const bytes = await gh.getFileRaw("acme", "app", "docs/read me.md", SHA);
    expect(new TextDecoder().decode(bytes)).toBe("hello");
    expect(fake.calls[0]!.url).toContain(`?ref=${SHA}`);
    expect(fake.calls[0]!.headers.Accept).toBe("application/vnd.github.raw+json");
    expect((await errorOf(gh.getFileRaw("acme", "app", "gone.md", SHA))).code).toBe("file_not_found");
  });

  it("never runs more than 6 requests at once", async () => {
    const { gh, fake } = client([{ match: /contents\//, responses: [{ body: "x" }] }], { delayMs: 5 });
    await Promise.all(Array.from({ length: 20 }, (_, i) => gh.getFileRaw("acme", "app", `f${i}.ts`, SHA)));
    expect(fake.maxInFlight).toBeLessThanOrEqual(6);
    expect(fake.calls).toHaveLength(20);
  });
});
