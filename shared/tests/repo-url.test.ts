import { describe, expect, it } from "vitest";
import { parseRepoUrl, REPO_URL_EXAMPLE, type RepoUrlErrorReason } from "../src/repo-url.js";

describe("parseRepoUrl — accepted forms", () => {
  it.each([
    ["https://github.com/vercel/next.js", "vercel", "next.js"],
    ["http://github.com/vercel/next.js", "vercel", "next.js"],
    ["https://www.github.com/vercel/next.js", "vercel", "next.js"],
    ["github.com/vercel/next.js", "vercel", "next.js"],
    ["  https://github.com/vercel/next.js/  ", "vercel", "next.js"],
    ["https://github.com/vercel/next.js.git", "vercel", "next.js"],
    ["git@github.com:vercel/next.js.git", "vercel", "next.js"],
    ["https://GitHub.com/Vercel/Next.js", "vercel", "next.js"],
    ["https://github.com/facebook/react?tab=readme-ov-file#readme", "facebook", "react"],
    ["https://github.com/a-b/c_d-e.f", "a-b", "c_d-e.f"],
  ])("%s → %s/%s", (input, owner, name) => {
    const result = parseRepoUrl(input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({ owner, name, kind: "repo", segments: [] });
    expect(result.value.htmlUrl).toBe(`https://github.com/${owner}/${name}`);
  });

  it("keeps tree segments as ref/subpath candidates without lowercasing them", () => {
    const result = parseRepoUrl("https://github.com/acme/app/tree/feature/Login-Form/packages/web");
    expect(result.ok && result.value).toMatchObject({
      kind: "tree",
      segments: ["feature", "Login-Form", "packages", "web"],
    });
  });

  it("parses blob URLs with the file path as segments", () => {
    const result = parseRepoUrl("https://github.com/acme/app/blob/main/src/index.ts");
    expect(result.ok && result.value).toMatchObject({
      kind: "blob",
      segments: ["main", "src", "index.ts"],
    });
  });

  it("decodes percent-encoded segments", () => {
    const result = parseRepoUrl("https://github.com/acme/app/tree/release%2F1.0");
    expect(result.ok && result.value.segments).toEqual(["release/1.0"]);
  });

  it("treats other repository sub-pages as the repository itself", () => {
    const result = parseRepoUrl("https://github.com/acme/app/issues/42");
    expect(result.ok && result.value).toMatchObject({ kind: "repo", segments: [] });
  });

  it("treats a bare /tree/ without a ref as the repository itself", () => {
    const result = parseRepoUrl("https://github.com/acme/app/tree/");
    expect(result.ok && result.value).toMatchObject({ kind: "repo", segments: [] });
  });
});

describe("parseRepoUrl — rejected inputs", () => {
  it.each<[string, RepoUrlErrorReason]>([
    ["", "empty"],
    ["   ", "empty"],
    ["https://gitlab.com/a/b", "not_github"],
    ["https://gist.github.com/someone/abc123", "not_github"],
    ["https://raw.githubusercontent.com/a/b/main/README.md", "not_github"],
    ["ftp://github.com/a/b", "not_github"],
    ["not a url at all", "not_github"],
    ["github.com/onlyowner", "missing_repo"],
    ["https://github.com", "missing_repo"],
    ["https://github.com/-bad/repo", "invalid_name"],
    ["https://github.com/owner/re po", "invalid_name"],
    // URL 표준이 ".."을 먼저 정규화하므로 경로가 비어 저장소 이름이 없는 주소가 된다
    ["https://github.com/owner/..", "missing_repo"],
    ["git@github.com:owner/re po.git", "invalid_name"],
    [`https://github.com/${"a".repeat(40)}/repo`, "invalid_name"],
    ["https://github.com/settings/profile", "not_repository_page"],
    ["https://github.com/orgs/acme", "not_repository_page"],
    ["https://github.com/topics", "not_repository_page"],
  ])("%j → %s", (input, reason) => {
    const result = parseRepoUrl(input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: "invalid_url", reason, example: REPO_URL_EXAMPLE });
    expect(result.error.message.length).toBeGreaterThan(0);
  });
});
