import type { Candidate } from "../db/json-types.js";
import type { TreeEntry } from "./client.js";

// 분석 가치가 없는 파일을 규칙으로 제외한다 (FR-010, Constitution I, research R7).

export type ExclusionReason =
  | "excluded_dir"
  | "excluded_ext"
  | "lockfile"
  | "minified"
  | "source_map"
  | "too_large"
  | "submodule"
  | "symlink";

export interface FilterResult {
  candidates: Candidate[];
  excluded: { path: string; reason: ExclusionReason }[];
  /** 읽지는 않지만 스택 감지에 쓰는 잠금 파일 경로 */
  lockfiles: string[];
}

export const EXCLUDED_DIRS = new Set([
  "node_modules",
  "vendor",
  "dist",
  "build",
  "out",
  ".next",
  ".nuxt",
  "target",
  "coverage",
  ".git",
  "__pycache__",
  ".venv",
  "venv",
  "bower_components",
  "pods",
  ".gradle",
  ".idea",
  ".vscode",
]);

const EXCLUDED_EXTENSIONS = new Set([
  // 이미지·아이콘
  "png", "jpg", "jpeg", "gif", "bmp", "ico", "webp", "svg", "tiff", "psd", "avif",
  // 폰트
  "woff", "woff2", "ttf", "otf", "eot",
  // 오디오·비디오
  "mp3", "mp4", "wav", "ogg", "flac", "mov", "avi", "webm", "mkv",
  // 압축·패키지
  "zip", "tar", "gz", "tgz", "bz2", "xz", "7z", "rar", "jar", "war", "whl", "nupkg",
  // 실행·바이너리
  "exe", "dll", "so", "dylib", "bin", "o", "a", "lib", "class", "pyc", "pyo", "wasm", "dmg", "iso", "apk", "ipa",
  // 문서 바이너리
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  // 데이터·모델 바이너리
  "db", "sqlite", "sqlite3", "parquet", "pkl", "npy", "npz", "h5", "onnx", "pt", "ckpt", "safetensors",
]);

export const LOCKFILES = new Set([
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "poetry.lock",
  "pipfile.lock",
  "uv.lock",
  "cargo.lock",
  "go.sum",
  "composer.lock",
  "gemfile.lock",
]);

const SYMLINK_MODE = "120000";

export function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function filterTree(entries: readonly TreeEntry[], options: { maxFileBytes: number }): FilterResult {
  const result: FilterResult = { candidates: [], excluded: [], lockfiles: [] };

  for (const entry of entries) {
    if (entry.type === "tree") continue;
    const exclude = (reason: ExclusionReason) => result.excluded.push({ path: entry.path, reason });

    if (entry.type === "commit") {
      exclude("submodule");
      continue;
    }
    const segments = entry.path.split("/");
    if (segments.slice(0, -1).some((segment) => EXCLUDED_DIRS.has(segment.toLowerCase()))) {
      exclude("excluded_dir");
      continue;
    }
    if (entry.mode === SYMLINK_MODE) {
      exclude("symlink");
      continue;
    }

    const name = basename(entry.path);
    const lower = name.toLowerCase();
    if (LOCKFILES.has(lower)) {
      result.lockfiles.push(entry.path);
      exclude("lockfile");
      continue;
    }
    if (/\.min\.(js|css|mjs)$/.test(lower)) {
      exclude("minified");
      continue;
    }
    if (lower.endsWith(".map")) {
      exclude("source_map");
      continue;
    }
    if (EXCLUDED_EXTENSIONS.has(extensionOf(lower))) {
      exclude("excluded_ext");
      continue;
    }
    const size = entry.size ?? 0;
    if (size > options.maxFileBytes) {
      exclude("too_large");
      continue;
    }
    result.candidates.push({ path: entry.path, size, blobSha: entry.sha });
  }

  return result;
}
