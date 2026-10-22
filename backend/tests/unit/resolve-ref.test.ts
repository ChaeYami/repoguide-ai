import { parseRepoUrl, type ParsedRepoUrl } from "@repoguide/shared";
import { describe, expect, it } from "vitest";
import { GitHubError, type RepoInfo } from "../../src/github/client.js";
import { resolveRepository } from "../../src/github/resolve-ref.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const repo: RepoInfo = {
  owner: "Acme",
  name: "App",
  private: false,
  defaultBranch: "main",
  description: null,
  language: "TypeScript",
  htmlUrl: "https://github.com/Acme/App",
};

function parsed(url: string): ParsedRepoUrl {
  const result = parseRepoUrl(url);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function fakeClient(knownRefs: string[], failWith?: GitHubError) {
  const tried: string[] = [];
  return {
    tried,
    client: {
      getRepo: async () => repo,
      getCommitSha: async (_owner: string, _name: string, ref: string) => {
        tried.push(ref);
        if (failWith) throw failWith;
        if (knownRefs.includes(ref)) return SHA;
        throw new GitHubError("ref_not_found", { status: 404 });
      },
    },
  };
}

describe("resolveRepository", () => {
  it("uses the default branch when the URL has no ref", async () => {
    const { client, tried } = fakeClient(["main"]);
    await expect(resolveRepository(client, parsed("https://github.com/acme/app"))).resolves.toEqual({
      repo,
      ref: "main",
      commitSha: SHA,
      subpath: null,
    });
    expect(tried).toEqual(["main"]);
  });

  it("finds a branch name that contains slashes and keeps the rest as subpath", async () => {
    const { client, tried } = fakeClient(["feature/login"]);
    const result = await resolveRepository(
      client,
      parsed("https://github.com/acme/app/tree/feature/login/packages/web"),
    );
    expect(result).toMatchObject({ ref: "feature/login", subpath: "packages/web" });
    expect(tried).toEqual(["feature", "feature/login"]);
  });

  it("uses the containing directory of a blob URL as subpath", async () => {
    const { client } = fakeClient(["v1.2.0"]);
    const result = await resolveRepository(client, parsed("https://github.com/acme/app/blob/v1.2.0/src/server/index.ts"));
    expect(result).toMatchObject({ ref: "v1.2.0", subpath: "src/server" });
  });

  it("stops after three attempts and reports ref_not_found", async () => {
    const { client, tried } = fakeClient([]);
    await expect(
      resolveRepository(client, parsed("https://github.com/acme/app/tree/a/b/c/d/e")),
    ).rejects.toMatchObject({ code: "ref_not_found" });
    expect(tried).toEqual(["a", "a/b", "a/b/c"]);
  });

  it("propagates non-ref errors such as rate limits immediately", async () => {
    const { client, tried } = fakeClient([], new GitHubError("github_rate_limited", { retryAfterSec: 30 }));
    await expect(
      resolveRepository(client, parsed("https://github.com/acme/app/tree/a/b")),
    ).rejects.toMatchObject({ code: "github_rate_limited" });
    expect(tried).toEqual(["a"]);
  });

  it("propagates repo_empty from the default branch lookup", async () => {
    const { client } = fakeClient([], new GitHubError("repo_empty", { status: 409 }));
    await expect(resolveRepository(client, parsed("https://github.com/acme/app"))).rejects.toMatchObject({
      code: "repo_empty",
    });
  });
});
