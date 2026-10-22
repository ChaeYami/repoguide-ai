import type { TreeEntry } from "../../src/github/client.js";

// 트리 fixture. 실제 GitHub 응답 형태(path, type, mode, sha, size)를 따른다.

let shaCounter = 0;
const blob = (path: string, size = 1_000, mode = "100644"): TreeEntry => ({
  path,
  type: "blob",
  mode,
  sha: `sha${(shaCounter += 1)}`,
  size,
});
const dir = (path: string): TreeEntry => ({ path, type: "tree", mode: "040000", sha: `tree-${path}` });

export const nodeMonorepoTree: TreeEntry[] = [
  blob("README.md", 2_000),
  blob("package.json", 800),
  blob("package-lock.json", 400_000),
  blob("tsconfig.json", 300),
  blob(".env.example", 200),
  blob("Dockerfile", 400),
  dir("apps"),
  blob("apps/web/README.md"),
  blob("apps/web/package.json", 600),
  blob("apps/web/src/main.tsx"),
  blob("apps/web/src/App.tsx"),
  blob("apps/web/public/logo.png", 20_000),
  blob("apps/web/dist/assets/index.min.js", 90_000),
  blob("apps/web/dist/assets/index.js.map", 300_000),
  blob("apps/api/package.json", 600),
  blob("apps/api/src/server.ts"),
  blob("apps/api/src/routes/users.ts"),
  blob("node_modules/react/index.js"),
  blob("fonts/Inter.woff2", 50_000),
  blob("data/huge.json", 5_000_000),
  { path: "libs/shared", type: "commit", mode: "160000", sha: "submodule" },
  blob("docs/link-to-readme", 20, "120000"),
];

export const pythonTree: TreeEntry[] = [
  blob("README.rst"),
  blob("readme.txt"),
  blob("pyproject.toml"),
  blob("requirements.txt"),
  blob("poetry.lock", 90_000),
  blob("app/__init__.py"),
  blob("app/main.py"),
  blob("app/__pycache__/main.cpython-312.pyc"),
  blob(".venv/lib/site.py"),
  blob("tests/test_main.py"),
];

export const docsOnlyTree: TreeEntry[] = [
  blob("README.md"),
  blob("docs/intro.md"),
  blob("docs/guide/setup.md"),
  blob("docs/images/diagram.svg"),
];

/** 파일 10,000개짜리 합성 모노레포 (packages/pkgNN/src/moduleNN/fileNN.ts) */
export function syntheticLargeTree(): TreeEntry[] {
  const entries: TreeEntry[] = [blob("README.md"), blob("package.json")];
  for (let p = 0; p < 50; p += 1) {
    entries.push(blob(`packages/pkg${p}/package.json`));
    for (let m = 0; m < 10; m += 1) {
      for (let f = 0; f < 20; f += 1) {
        entries.push(blob(`packages/pkg${p}/src/module${m}/file${f}.ts`, 500));
      }
    }
  }
  return entries;
}
