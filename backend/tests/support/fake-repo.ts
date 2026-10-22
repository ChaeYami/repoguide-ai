import type { Candidate } from "../../src/db/json-types.js";
import { GitHubError } from "../../src/github/client.js";

// 파이프라인 테스트용 가짜 저장소: 경로 → 원문. getFileRaw만 흉내 낸다.

export const FIXTURE_SHA = "0123456789abcdef0123456789abcdef01234567";

export const FIXTURE_FILES: Record<string, string> = {
  "README.md": "# Demo\n\n짧은 소개뿐인 README.\n",
  "package.json": JSON.stringify({ name: "demo", scripts: { dev: "vite", start: "node server.js", test: "vitest" }, dependencies: { express: "5" } }, null, 2) + "\n",
  ".env.example": "PORT=3000\nDATABASE_URL=\n",
  "src/server.ts": "import express from 'express';\nconst app = express();\napp.listen(process.env.PORT);\n",
  "src/routes/users.ts": "export function listUsers() {\n  return [];\n}\n",
  "src/db.ts": "export const db = connect(process.env.DATABASE_URL);\n",
  "docs/setup.md": "# Setup\n\n1. npm install\n2. npm run dev\n",
  "tests/server.test.ts": "test('starts', () => {});\n",
  "Dockerfile": "FROM node:24\nCMD [\"npm\", \"start\"]\n",
};

export function fixtureCandidates(files: Record<string, string> = FIXTURE_FILES): Candidate[] {
  return Object.entries(files).map(([path, content]) => ({ path, size: content.length, blobSha: `blob-${path}` }));
}

export function fixtureDirectories(files: Record<string, string> = FIXTURE_FILES): Set<string> {
  const dirs = new Set<string>();
  for (const path of Object.keys(files)) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 1) dirs.add(parts.slice(0, i).join("/"));
  }
  return dirs;
}

/** 분석 파이프라인용 가짜 GitHub: 저장소 정보·커밋·트리·파일 원문. 오류를 메서드별로 주입할 수 있다. */
export function fakeGithubRepo(
  options: {
    files?: Record<string, string>;
    extraTree?: { path: string; type: "blob" | "tree" | "commit"; mode?: string; size?: number }[];
    /** 심볼릭 링크: 링크 경로 → 대상 경로(링크 위치 기준 상대 경로) */
    symlinks?: Record<string, string>;
    errors?: Partial<Record<"getRepo" | "getCommitSha" | "getTree", GitHubError>>;
    truncated?: boolean;
    /** 파일을 이만큼 읽은 뒤에는 저장소가 사라진다(파일 404, 저장소 조회 실패) */
    repoGoneAfterFileReads?: number;
    /** 파일을 이만큼 읽은 뒤에는 파일 읽기가 이 오류로 실패한다 */
    failFileReadsAfter?: { count: number; error: GitHubError };
    /** 커밋 조회마다 다른 SHA를 돌려준다(분석 도중 새 커밋) */
    commitShas?: string[];
  } = {},
) {
  const files = options.files ?? FIXTURE_FILES;
  const calls: string[] = [];
  const fileReads: { path: string; sha: string }[] = [];
  const dirs = [...fixtureDirectories(files)].map((path) => ({ path, type: "tree" as const, mode: "040000", sha: `tree-${path}` }));
  const blobs = Object.entries(files).map(([path, content]) => ({ path, type: "blob" as const, mode: "100644", sha: `blob-${path}`, size: content.length }));
  const links = Object.entries(options.symlinks ?? {}).map(([path, target]) => ({ path, type: "blob" as const, mode: "120000", sha: `link-${path}`, size: target.length }));
  const extra = (options.extraTree ?? []).map((entry) => ({ mode: "100644", sha: `x-${entry.path}`, ...entry }));
  const fail = (method: keyof NonNullable<typeof options.errors>) => {
    const error = options.errors?.[method];
    if (error) throw error;
  };
  const repoGone = () => options.repoGoneAfterFileReads !== undefined && fileReads.length >= options.repoGoneAfterFileReads;
  let commitCalls = 0;
  return {
    calls,
    fileReads,
    github: {
      async getRepo(owner: string, name: string) {
        calls.push("getRepo");
        fail("getRepo");
        if (repoGone()) throw new GitHubError("repo_not_found_or_private", { status: 404 });
        return { owner: "Acme", name: "Demo", private: false, defaultBranch: "main", description: "데모 앱", language: "TypeScript", htmlUrl: `https://github.com/${owner}/${name}` };
      },
      async getCommitSha() {
        calls.push("getCommitSha");
        fail("getCommitSha");
        const shas = options.commitShas ?? [FIXTURE_SHA];
        return shas[Math.min(commitCalls++, shas.length - 1)]!;
      },
      async getTree() {
        calls.push("getTree");
        fail("getTree");
        return { truncated: options.truncated ?? false, entries: [...dirs, ...blobs, ...links, ...extra] };
      },
      async getFileRaw(_owner: string, _name: string, path: string, sha: string) {
        calls.push(`file:${path}`);
        if (repoGone()) throw new GitHubError("file_not_found", { status: 404 });
        if (options.failFileReadsAfter && fileReads.length >= options.failFileReadsAfter.count) throw options.failFileReadsAfter.error;
        const content = files[path];
        if (content === undefined) throw new GitHubError("file_not_found", { status: 404 });
        fileReads.push({ path, sha });
        return new TextEncoder().encode(content);
      },
      async getBlobText(_owner: string, _name: string, sha: string) {
        calls.push(`blob:${sha}`);
        const link = Object.entries(options.symlinks ?? {}).find(([path]) => `link-${path}` === sha);
        if (!link) throw new GitHubError("file_not_found", { status: 404 });
        return link[1];
      },
    },
  };
}

export function fakeRepoFiles(files: Record<string, string> = FIXTURE_FILES) {
  const requested: string[] = [];
  return {
    requested,
    github: {
      async getFileRaw(_owner: string, _name: string, path: string) {
        requested.push(path);
        const content = files[path];
        if (content === undefined) throw new GitHubError("file_not_found", { status: 404 });
        return new TextEncoder().encode(content);
      },
    },
  };
}
