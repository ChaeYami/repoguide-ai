// GitHub 저장소 URL 파서 (FR-001, FR-002). 프론트 즉시 검증과 백엔드 API 검증이 같은 규칙을 쓴다.
// ref·하위 경로는 브랜치 이름에 "/"가 들어갈 수 있어 여기서 확정하지 않고 세그먼트 후보로만 넘긴다(research R6).

export const REPO_URL_EXAMPLE = "https://github.com/owner/repo";

export type RepoUrlKind = "repo" | "tree" | "blob";

export interface ParsedRepoUrl {
  owner: string;
  name: string;
  kind: RepoUrlKind;
  /** `/tree/` 또는 `/blob/` 뒤의 세그먼트. ref와 하위 경로가 섞여 있다. */
  segments: string[];
  htmlUrl: string;
}

export type RepoUrlErrorReason =
  | "empty"
  | "not_github"
  | "missing_repo"
  | "invalid_name"
  | "not_repository_page";

export interface RepoUrlError {
  code: "invalid_url";
  reason: RepoUrlErrorReason;
  message: string;
  example: string;
}

export type ParseRepoUrlResult =
  | { ok: true; value: ParsedRepoUrl }
  | { ok: false; error: RepoUrlError };

const MESSAGES: Record<RepoUrlErrorReason, string> = {
  empty: "저장소 URL을 입력해 주세요.",
  not_github: "GitHub 저장소 주소만 지원합니다.",
  missing_repo: "소유자와 저장소 이름이 모두 들어간 주소를 입력해 주세요.",
  invalid_name: "저장소 소유자나 이름에 쓸 수 없는 문자가 있습니다.",
  not_repository_page: "GitHub 저장소 페이지 주소가 아닙니다.",
};

// github.com/<이 이름>/... 은 사용자·조직이 아니라 GitHub 자체 페이지다.
const RESERVED_OWNERS = new Set([
  "about",
  "apps",
  "codespaces",
  "collections",
  "contact",
  "dashboard",
  "enterprise",
  "explore",
  "features",
  "issues",
  "join",
  "login",
  "marketplace",
  "new",
  "notifications",
  "orgs",
  "organizations",
  "pricing",
  "pulls",
  "search",
  "security",
  "settings",
  "site",
  "sponsors",
  "topics",
  "trending",
]);

const OWNER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const SSH_PATTERN = /^git@github\.com:([^/]+)\/([^/]+?)\/?$/i;

function fail(reason: RepoUrlErrorReason): ParseRepoUrlResult {
  return {
    ok: false,
    error: { code: "invalid_url", reason, message: MESSAGES[reason], example: REPO_URL_EXAMPLE },
  };
}

function splitPath(input: string): string[] | null {
  const ssh = SSH_PATTERN.exec(input);
  if (ssh) return [ssh[1]!, ssh[2]!];

  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "github.com") return null;

  try {
    return url.pathname
      .split("/")
      .filter((segment) => segment.length > 0)
      .map((segment) => decodeURIComponent(segment));
  } catch {
    return null;
  }
}

export function parseRepoUrl(input: string): ParseRepoUrlResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) return fail("empty");

  const path = splitPath(trimmed);
  if (path === null) return fail("not_github");

  const [rawOwner, rawRepo, ...rest] = path;
  if (rawOwner === undefined || rawRepo === undefined) {
    return fail(rawOwner !== undefined && RESERVED_OWNERS.has(rawOwner.toLowerCase())
      ? "not_repository_page"
      : "missing_repo");
  }
  if (RESERVED_OWNERS.has(rawOwner.toLowerCase())) return fail("not_repository_page");

  const repo = rawRepo.replace(/\.git$/i, "");
  if (!OWNER_PATTERN.test(rawOwner) || !REPO_PATTERN.test(repo) || repo === "." || repo === "..") {
    return fail("invalid_name");
  }

  const owner = rawOwner.toLowerCase();
  const name = repo.toLowerCase();
  const [marker, ...segments] = rest;
  const kind: RepoUrlKind =
    (marker === "tree" || marker === "blob") && segments.length > 0 ? marker : "repo";

  return {
    ok: true,
    value: {
      owner,
      name,
      kind,
      segments: kind === "repo" ? [] : segments,
      htmlUrl: `https://github.com/${owner}/${name}`,
    },
  };
}
