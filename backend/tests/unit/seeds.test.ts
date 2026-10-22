import { describe, expect, it } from "vitest";
import { selectSeeds } from "../../src/github/seeds.js";
import { filterTree } from "../../src/github/tree-filter.js";
import { docsOnlyTree, nodeMonorepoTree, pythonTree } from "../fixtures/trees.js";

const candidatesOf = (tree: Parameters<typeof filterTree>[0]) =>
  filterTree(tree, { maxFileBytes: 200_000 }).candidates;

describe("selectSeeds", () => {
  it("picks the root README and manifests in priority order, at most 6", () => {
    expect(selectSeeds(candidatesOf(nodeMonorepoTree), null)).toEqual([
      { path: "README.md", rule: "readme" },
      { path: "package.json", rule: "manifest:package.json" },
      { path: "Dockerfile", rule: "manifest:Dockerfile" },
      { path: ".env.example", rule: "manifest:.env.example" },
    ]);
  });

  it("prioritises the subpath README and manifests when the URL points into a package", () => {
    expect(selectSeeds(candidatesOf(nodeMonorepoTree), "apps/web")).toEqual([
      { path: "apps/web/README.md", rule: "subpath-readme" },
      { path: "README.md", rule: "readme" },
      { path: "apps/web/package.json", rule: "subpath-manifest:package.json" },
      { path: "package.json", rule: "manifest:package.json" },
      { path: "Dockerfile", rule: "manifest:Dockerfile" },
      { path: ".env.example", rule: "manifest:.env.example" },
    ]);
  });

  it("prefers README.md over other README formats and orders Python manifests", () => {
    const seeds = selectSeeds(candidatesOf(pythonTree), null);
    expect(seeds.map((s) => s.path)).toEqual(["README.rst", "pyproject.toml", "requirements.txt"]);
  });

  it("returns only the README for docs-only repositories", () => {
    expect(selectSeeds(candidatesOf(docsOnlyTree), null)).toEqual([{ path: "README.md", rule: "readme" }]);
  });

  it("returns nothing when there is no README or manifest", () => {
    expect(selectSeeds([{ path: "src/a.ts", size: 1, blobSha: "x" }], null)).toEqual([]);
  });
});
