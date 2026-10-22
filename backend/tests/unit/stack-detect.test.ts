import { describe, expect, it } from "vitest";
import { detectStack } from "../../src/github/stack-detect.js";
import { filterTree } from "../../src/github/tree-filter.js";
import { nodeMonorepoTree, pythonTree } from "../fixtures/trees.js";

describe("detectStack", () => {
  it("detects languages, package manager and frameworks of a Node monorepo", () => {
    const filtered = filterTree(nodeMonorepoTree, { maxFileBytes: 200_000 });
    const stack = detectStack({
      paths: filtered.candidates.map((c) => c.path),
      lockfiles: filtered.lockfiles,
      manifestContents: {
        "package.json": JSON.stringify({
          dependencies: { react: "^19.0.0", fastify: "^5.0.0" },
          devDependencies: { vite: "^8.0.0", vitest: "^5.0.0" },
        }),
      },
    });
    expect(stack).toEqual({
      languages: ["TypeScript"],
      packageManagers: ["npm"],
      frameworkHints: ["React", "Fastify", "Vite", "Vitest"],
      manifests: [
        ".env.example",
        "Dockerfile",
        "package.json",
        "apps/api/package.json",
        "apps/web/package.json",
      ],
    });
  });

  it("detects Python tooling and frameworks from manifest contents", () => {
    const filtered = filterTree(pythonTree, { maxFileBytes: 200_000 });
    const stack = detectStack({
      paths: filtered.candidates.map((c) => c.path),
      lockfiles: filtered.lockfiles,
      manifestContents: { "requirements.txt": "fastapi==0.120.0\nuvicorn\n" },
    });
    expect(stack.languages).toEqual(["Python"]);
    expect(stack.packageManagers).toEqual(["poetry", "pip"]);
    expect(stack.frameworkHints).toEqual(["FastAPI"]);
  });

  it("does not report npm when another JS lockfile decides the package manager", () => {
    const stack = detectStack({ paths: ["package.json", "src/a.js"], lockfiles: ["pnpm-lock.yaml"], manifestContents: {} });
    expect(stack.packageManagers).toEqual(["pnpm"]);
  });

  it("ranks the top five languages by file count and ignores invalid package.json", () => {
    const paths = [
      ...Array.from({ length: 3 }, (_, i) => `a${i}.go`),
      ...Array.from({ length: 2 }, (_, i) => `b${i}.py`),
      "c.rs", "d.rb", "e.php", "f.swift", "README.md",
    ];
    const stack = detectStack({ paths, lockfiles: [], manifestContents: { "package.json": "{not json" } });
    expect(stack.languages).toEqual(["Go", "Python", "PHP", "Ruby", "Rust"]);
    expect(stack.frameworkHints).toEqual([]);
  });
});
