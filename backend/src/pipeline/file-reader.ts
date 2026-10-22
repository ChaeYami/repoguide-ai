import type { Candidate } from "../db/json-types.js";
import type { FileCache } from "../db/repositories/files.js";
import { GitHubError, type GitHubClient } from "../github/client.js";

// 커밋에 고정된 파일 원문을 읽는다 (FR-016: 읽기만 하고 실행하지 않는다, FR-017: 커밋 SHA 고정).

export type SkippedReason = "binary" | "lfs_pointer" | "not_found";

export interface ReadFileResult {
  path: string;
  sizeBytes: number;
  /** 바이너리·LFS·없는 파일이면 null */
  content: string | null;
  /** 전달된(잘렸다면 잘린 뒤) 줄 수. 인용 검증의 기준이다(R8). */
  lineCount: number;
  truncated: boolean;
  skippedReason: SkippedReason | null;
  snapshotFileId: string | null;
  fromCache: boolean;
}

export interface ReadFilesOptions {
  client: Pick<GitHubClient, "getFileRaw">;
  owner: string;
  name: string;
  commitSha: string;
  files: readonly Candidate[];
  maxCharsPerFile: number;
  /** 있으면 snapshot_files에 저장하고, 이미 있으면 GitHub를 다시 호출하지 않는다. */
  cache?: { snapshotId: string; store: FileCache };
  onProgress?: (done: number, total: number) => void;
  progressEvery?: number;
}

const BINARY_SNIFF_BYTES = 8_192;
const LFS_POINTER_PREFIX = "version https://git-lfs.github.com/spec/v1";
const decoder = new TextDecoder("utf-8");
const BOM = 0xfeff;

const stripBom = (text: string) => (text.charCodeAt(0) === BOM ? text.slice(1) : text);

export function countLines(content: string): number {
  if (content.length === 0) return 0;
  const lines = content.split("\n").length;
  return content.endsWith("\n") ? lines - 1 : lines;
}

/** 줄 중간에서 끊기지 않도록 상한 이전의 마지막 줄바꿈에서 자른다(절반보다 앞이면 그냥 상한에서 자른다). */
export function truncateContent(content: string, maxChars: number): { content: string; truncated: boolean } {
  if (content.length <= maxChars) return { content, truncated: false };
  const head = content.slice(0, maxChars);
  const lastNewline = head.lastIndexOf("\n");
  return { content: lastNewline >= maxChars / 2 ? head.slice(0, lastNewline + 1) : head, truncated: true };
}

export function decodeFile(bytes: Uint8Array, maxChars: number): Pick<ReadFileResult, "content" | "lineCount" | "truncated" | "skippedReason"> {
  if (bytes.subarray(0, BINARY_SNIFF_BYTES).includes(0)) {
    return { content: null, lineCount: 0, truncated: false, skippedReason: "binary" };
  }
  const text = stripBom(decoder.decode(bytes));
  if (text.startsWith(LFS_POINTER_PREFIX)) {
    return { content: null, lineCount: 0, truncated: false, skippedReason: "lfs_pointer" };
  }
  const { content, truncated } = truncateContent(text, maxChars);
  return { content, lineCount: countLines(content), truncated, skippedReason: null };
}

export async function readFiles(options: ReadFilesOptions): Promise<ReadFileResult[]> {
  const total = options.files.length;
  const every = options.progressEvery ?? 5;
  let done = 0;
  const tick = () => {
    done += 1;
    if (done % every === 0 || done === total) options.onProgress?.(done, total);
  };

  return Promise.all(
    options.files.map(async (file): Promise<ReadFileResult> => {
      const cached = options.cache
        ? await options.cache.store.getSnapshotFile(options.cache.snapshotId, file.path)
        : null;
      if (cached) {
        tick();
        return {
          path: file.path,
          sizeBytes: cached.sizeBytes,
          content: cached.content,
          lineCount: cached.lineCount,
          truncated: cached.truncated,
          skippedReason: (cached.skippedReason as SkippedReason | null) ?? null,
          snapshotFileId: cached.id,
          fromCache: true,
        };
      }

      let decoded: Pick<ReadFileResult, "content" | "lineCount" | "truncated" | "skippedReason">;
      try {
        const bytes = await options.client.getFileRaw(options.owner, options.name, file.path, options.commitSha);
        decoded = decodeFile(bytes, options.maxCharsPerFile);
      } catch (error) {
        // 트리에는 있는데 내용이 없는 파일은 건너뛴다. 한도 초과·장애는 상위로 올려 분석 상태에 반영한다.
        if (!(error instanceof GitHubError) || error.code !== "file_not_found") throw error;
        decoded = { content: null, lineCount: 0, truncated: false, skippedReason: "not_found" };
      }

      const stored = options.cache
        ? await options.cache.store.upsertSnapshotFile({
            snapshotId: options.cache.snapshotId,
            path: file.path,
            blobSha: file.blobSha,
            sizeBytes: file.size,
            ...decoded,
          })
        : null;
      tick();
      return { path: file.path, sizeBytes: file.size, ...decoded, snapshotFileId: stored?.id ?? null, fromCache: false };
    }),
  );
}
