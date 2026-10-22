import { describe, expect, it } from "vitest";
import { filterTree } from "../../src/github/tree-filter.js";
import { buildTreeListing } from "../../src/github/tree-listing.js";
import { nodeMonorepoTree, syntheticLargeTree } from "../fixtures/trees.js";

const candidatesOf = (tree: Parameters<typeof filterTree>[0]) =>
  filterTree(tree, { maxFileBytes: 200_000 }).candidates;

describe("buildTreeListing", () => {
  it("lists every file with its size when under the limit", () => {
    const listing = buildTreeListing(candidatesOf(nodeMonorepoTree));
    expect(listing.lineCount).toBe(12);
    expect(listing.collapsedDirectories).toEqual([]);
    expect(listing.text.split("\n")).toContain("apps/api/src/server.ts (1000 B)");
  });

  it("collapses the 10,000-file tree to fit 2,000 lines", () => {
    const listing = buildTreeListing(candidatesOf(syntheticLargeTree()));
    expect(listing.lineCount).toBeLessThanOrEqual(2_000);
    expect(listing.omitted).toBe(0);
    expect(listing.text).toContain("packages/pkg0/src/module0/ (20 files)");
    expect(listing.collapsedDirectories).toContain("packages/pkg49/src/module9");
  });

  it("collapses to the deepest level that fits a small limit", () => {
    const listing = buildTreeListing(candidatesOf(syntheticLargeTree()), { maxEntries: 60 });
    expect(listing.text.split("\n")).toContain("packages/pkg7/ (201 files)");
    expect(listing.text.split("\n")).toContain("README.md (1000 B)");
    expect(listing.lineCount).toBe(52);
  });

  it("expands requested directories into individual files", () => {
    const listing = buildTreeListing(candidatesOf(syntheticLargeTree()), {
      maxEntries: 80,
      expanded: ["packages/pkg3/src/module2"],
    });
    const lines = listing.text.split("\n");
    expect(lines).toContain("packages/pkg3/src/module2/file19.ts (500 B)");
    expect(listing.collapsedDirectories).not.toContain("packages/pkg3/src/module2");
  });

  it("collapses everything to top-level directories before truncating", () => {
    const listing = buildTreeListing(candidatesOf(syntheticLargeTree()), { maxEntries: 10 });
    expect(listing.text).toBe("README.md (1000 B)\npackage.json (1000 B)\npackages/ (10050 files)");
    expect(listing.omitted).toBe(0);
  });

  it("truncates with an explicit marker when expanded directories cannot fit", () => {
    const listing = buildTreeListing(candidatesOf(syntheticLargeTree()), { maxEntries: 10, expanded: ["packages"] });
    expect(listing.lineCount).toBe(10);
    expect(listing.omitted).toBeGreaterThan(0);
    expect(listing.text).toMatch(/\.\.\. \(\d+ more\)$/);
  });
});
