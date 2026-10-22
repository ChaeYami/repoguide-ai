import { parseRepoUrl } from "@repoguide/shared";
import { describe, expect, it } from "vitest";
import { GitHubClient } from "../../src/github/client.js";
import { ingestRepository } from "../../src/github/ingest.js";
import { nodeMonorepoTree } from "../fixtures/trees.js";
import { createFakeFetch, repoBody } from "../support/fake-fetch.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";

function parsed(url: string) {
  const result = parseRepoUrl(url);
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function githubFixture() {
  const fake = createFakeFetch([
    { match: /\/repos\/acme\/app$/, responses: [{ body: repoBody() }] },
    { match: /\/commits\/main$/, responses: [{ body: SHA }] },
    { match: /\/git\/trees\//, responses: [{ body: { truncated: false, tree: nodeMonorepoTree } }] },
    { match: /contents\/README\.md\?/, responses: [{ body: "# App\n\n짧은 설명\n" }] },
    {
      match: /contents\/package\.json\?/,
      responses: [{ body: JSON.stringify({ dependencies: { react: "19", fastify: "5" } }) }],
    },
    { match: /contents\/Dockerfile\?/, responses: [{ body: "FROM node:24\n" }] },
    { match: /contents\/\.env\.example\?/, responses: [{ body: "PORT=3000\n" }] },
  ]);
  const calls: string[] = [];
  const client = new GitHubClient({ fetch: fake.fetch, onCall: (call) => calls.push(call.path) });
  return { client, calls };
}

describe("ingestRepository (fake GitHub)", () => {
  it("resolves the commit, filters the tree, reads seeds and detects the stack", async () => {
    const { client, calls } = githubFixture();
    const result = await ingestRepository(client, parsed("https://github.com/acme/app"), {
      maxFileBytes: 200_000,
      maxCharsPerFile: 60_000,
    });

    expect(result).toMatchObject({ ref: "main", commitSha: SHA, subpath: null, treeTruncated: false, treeEntryCount: 22 });
    expect(result.candidates).toHaveLength(12);
    expect(result.seeds.map((seed) => [seed.path, seed.rule, seed.lineCount])).toEqual([
      ["README.md", "readme", 3],
      ["package.json", "manifest:package.json", 1],
      ["Dockerfile", "manifest:Dockerfile", 1],
      [".env.example", "manifest:.env.example", 1],
    ]);
    expect(result.detectedStack.frameworkHints).toEqual(["React", "Fastify"]);
    expect(result.detectedStack.packageManagers).toEqual(["npm"]);
    // 저장소 1 + 커밋 1 + 트리 1 + 시드 4
    expect(calls).toHaveLength(7);
  });

  it("does not read README only — manifests are part of the seed set (FR-008)", async () => {
    const { client } = githubFixture();
    const result = await ingestRepository(client, parsed("github.com/acme/app"), { maxFileBytes: 200_000, maxCharsPerFile: 60_000 });
    expect(result.seeds.some((seed) => seed.rule.startsWith("manifest:"))).toBe(true);
  });
});
