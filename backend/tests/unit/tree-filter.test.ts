import { describe, expect, it } from "vitest";
import { filterTree } from "../../src/github/tree-filter.js";
import { docsOnlyTree, nodeMonorepoTree, pythonTree } from "../fixtures/trees.js";

const MAX = 200_000;

describe("filterTree", () => {
  it("keeps source, docs and manifests and records why everything else was excluded", () => {
    const result = filterTree(nodeMonorepoTree, { maxFileBytes: MAX });
    expect(result.candidates.map((c) => c.path)).toEqual([
      "README.md",
      "package.json",
      "tsconfig.json",
      ".env.example",
      "Dockerfile",
      "apps/web/README.md",
      "apps/web/package.json",
      "apps/web/src/main.tsx",
      "apps/web/src/App.tsx",
      "apps/api/package.json",
      "apps/api/src/server.ts",
      "apps/api/src/routes/users.ts",
    ]);
    expect(Object.fromEntries(result.excluded.map((e) => [e.path, e.reason]))).toEqual({
      "package-lock.json": "lockfile",
      "apps/web/public/logo.png": "excluded_ext",
      "apps/web/dist/assets/index.min.js": "excluded_dir",
      "apps/web/dist/assets/index.js.map": "excluded_dir",
      "node_modules/react/index.js": "excluded_dir",
      "fonts/Inter.woff2": "excluded_ext",
      "data/huge.json": "too_large",
      "libs/shared": "submodule",
      "docs/link-to-readme": "symlink",
    });
    expect(result.lockfiles).toEqual(["package-lock.json"]);
  });

  it("excludes minified bundles and source maps outside build directories", () => {
    const result = filterTree(
      [
        { path: "public/vendor.min.js", type: "blob", mode: "100644", sha: "1", size: 10 },
        { path: "static/app.css.map", type: "blob", mode: "100644", sha: "2", size: 10 },
      ],
      { maxFileBytes: MAX },
    );
    expect(result.excluded.map((e) => e.reason)).toEqual(["minified", "source_map"]);
  });

  it("excludes virtualenvs and bytecode caches in Python projects", () => {
    const result = filterTree(pythonTree, { maxFileBytes: MAX });
    expect(result.candidates.map((c) => c.path)).not.toContain(".venv/lib/site.py");
    expect(result.candidates.map((c) => c.path)).not.toContain("app/__pycache__/main.cpython-312.pyc");
    expect(result.lockfiles).toEqual(["poetry.lock"]);
  });

  it("keeps markdown docs but drops images in docs-only repositories", () => {
    const result = filterTree(docsOnlyTree, { maxFileBytes: MAX });
    expect(result.candidates.map((c) => c.path)).toEqual(["README.md", "docs/intro.md", "docs/guide/setup.md"]);
  });

  it("respects the configured size limit", () => {
    const result = filterTree(nodeMonorepoTree, { maxFileBytes: 500 });
    expect(result.candidates.every((c) => c.size <= 500)).toBe(true);
    expect(result.excluded.some((e) => e.path === "README.md" && e.reason === "too_large")).toBe(true);
  });
});
