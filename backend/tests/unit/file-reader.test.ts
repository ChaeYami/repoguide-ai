import { describe, expect, it } from "vitest";
import type { SnapshotFileRow } from "../../src/db/repositories/files.js";
import { GitHubError } from "../../src/github/client.js";
import { countLines, readFiles, truncateContent } from "../../src/pipeline/file-reader.js";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const encode = (text: string) => new TextEncoder().encode(text);

function fakeClient(files: Record<string, Uint8Array | GitHubError>) {
  const requested: string[] = [];
  return {
    requested,
    client: {
      getFileRaw: async (_owner: string, _name: string, path: string, sha: string) => {
        expect(sha).toBe(SHA);
        requested.push(path);
        const value = files[path];
        if (value instanceof GitHubError) throw value;
        if (!value) throw new Error(`unexpected path ${path}`);
        return value;
      },
    },
  };
}

function memoryCache() {
  const rows = new Map<string, SnapshotFileRow>();
  return {
    rows,
    store: {
      getSnapshotFile: async (snapshotId: string, path: string) => rows.get(`${snapshotId}:${path}`) ?? null,
      upsertSnapshotFile: async (input: Omit<SnapshotFileRow, "id" | "fetchedAt">) => {
        const row = { ...input, id: `id-${rows.size + 1}`, fetchedAt: new Date() } as SnapshotFileRow;
        rows.set(`${input.snapshotId}:${input.path}`, row);
        return row;
      },
    },
  };
}

const file = (path: string, size = 10) => ({ path, size, blobSha: `blob-${path}` });

describe("countLines / truncateContent", () => {
  it.each([
    ["", 0],
    ["one", 1],
    ["one\n", 1],
    ["one\ntwo", 2],
    ["one\ntwo\n", 2],
  ])("%j has %i lines", (content, lines) => {
    expect(countLines(content)).toBe(lines);
  });

  it("cuts at the last newline before the limit", () => {
    expect(truncateContent("aaaa\nbbbb\ncccc\n", 12)).toEqual({ content: "aaaa\nbbbb\n", truncated: true });
  });

  it("cuts mid-line when the last newline is too early", () => {
    expect(truncateContent("a\nbbbbbbbbbbbbbbbbbbbb", 10)).toEqual({ content: "a\nbbbbbbbb", truncated: true });
  });
});

describe("readFiles", () => {
  it("decodes text, strips a BOM and counts lines", async () => {
    const { client } = fakeClient({ "README.md": encode(String.fromCharCode(0xfeff) + "# 앱\n\n설명\n") });
    const [result] = await readFiles({ client, owner: "acme", name: "app", commitSha: SHA, files: [file("README.md")], maxCharsPerFile: 1000 });
    expect(result).toMatchObject({ content: "# 앱\n\n설명\n", lineCount: 3, truncated: false, skippedReason: null });
  });

  it("skips binary files, LFS pointers and files missing at the commit", async () => {
    const { client } = fakeClient({
      "logo.dat": new Uint8Array([137, 80, 78, 71, 0, 1, 2]),
      "model.bin.txt": encode("version https://git-lfs.github.com/spec/v1\noid sha256:abc\nsize 123\n"),
      "gone.ts": new GitHubError("file_not_found", { status: 404 }),
    });
    const results = await readFiles({
      client,
      owner: "acme",
      name: "app",
      commitSha: SHA,
      files: [file("logo.dat"), file("model.bin.txt"), file("gone.ts")],
      maxCharsPerFile: 1000,
    });
    expect(results.map((r) => [r.path, r.skippedReason, r.content])).toEqual([
      ["logo.dat", "binary", null],
      ["model.bin.txt", "lfs_pointer", null],
      ["gone.ts", "not_found", null],
    ]);
  });

  it("truncates long files and reports the truncated line count", async () => {
    const long = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n");
    const { client } = fakeClient({ "big.ts": encode(long) });
    const [result] = await readFiles({ client, owner: "acme", name: "app", commitSha: SHA, files: [file("big.ts")], maxCharsPerFile: 70 });
    expect(result!.truncated).toBe(true);
    expect(result!.content!.length).toBeLessThanOrEqual(70);
    expect(result!.lineCount).toBe(countLines(result!.content!));
  });

  it("propagates rate limits instead of hiding them", async () => {
    const { client } = fakeClient({ "a.ts": new GitHubError("github_rate_limited", { retryAfterSec: 60 }) });
    await expect(
      readFiles({ client, owner: "acme", name: "app", commitSha: SHA, files: [file("a.ts")], maxCharsPerFile: 1000 }),
    ).rejects.toMatchObject({ code: "github_rate_limited" });
  });

  it("stores results in the snapshot cache and reuses them without calling GitHub", async () => {
    const cache = memoryCache();
    const first = fakeClient({ "a.ts": encode("export const a = 1;\n") });
    const options = { owner: "acme", name: "app", commitSha: SHA, files: [file("a.ts")], maxCharsPerFile: 1000, cache: { snapshotId: "snap-1", store: cache.store } };

    const [stored] = await readFiles({ ...options, client: first.client });
    expect(stored).toMatchObject({ fromCache: false, snapshotFileId: "id-1" });

    const second = fakeClient({});
    const [reused] = await readFiles({ ...options, client: second.client });
    expect(reused).toMatchObject({ fromCache: true, snapshotFileId: "id-1", content: "export const a = 1;\n" });
    expect(second.requested).toEqual([]);
  });

  it("reports progress every N files and at the end", async () => {
    const files = Array.from({ length: 12 }, (_, i) => file(`f${i}.ts`));
    const { client } = fakeClient(Object.fromEntries(files.map((f) => [f.path, encode("x\n")])));
    const progress: number[] = [];
    await readFiles({ client, owner: "acme", name: "app", commitSha: SHA, files, maxCharsPerFile: 100, onProgress: (done) => progress.push(done) });
    expect(progress).toEqual([5, 10, 12]);
  });
});
