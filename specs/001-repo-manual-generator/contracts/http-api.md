# HTTP API Contract

**Base path**: `/api` | **형식**: JSON (UTF-8) | **인증**: 없음 (로그인 없음, FR-030)

스키마의 원본은 `shared/src/api.ts`의 zod 정의이며, 이 문서는 그 계약을 설명한다. 타입 표기는
TypeScript 문법을 따른다. enum 값은 [data-model.md](../data-model.md)를 참조한다.

## 공통

### 오류 응답

```ts
type ErrorResponse = {
  error: {
    code: ErrorCode;          // 아래 표
    message: string;          // 한국어, 사용자에게 그대로 보여줄 수 있는 문장 (FR-029: 내부 상세 금지)
    action?: string;          // 사용자가 할 수 있는 조치 (FR-028)
    retryAfterSec?: number;   // 재시도 가능까지 남은 초
  };
};
```

| HTTP | `code` | 상황 |
|------|--------|------|
| 400 | `invalid_url` | GitHub 저장소 URL 형식이 아님 (FR-002). `action`에 올바른 형식 예시 |
| 400 | `invalid_request` | 수준·목적 누락, 잘못된 enum, 재생성 옵션이 부모와 동일 |
| 404 | `not_found` | 존재하지 않는 분석 ID |
| 409 | `not_ready` | 매뉴얼이 아직 없음 (queued/running/failed) |
| 409 | `already_latest` | `refresh_commit` 요청인데 새 커밋이 없음 |
| 409 | `parent_not_finished` | 진행 중이거나 실패한 분석을 재생성하려 함 |
| 410 | `expired` | 보관 기간이 지난 결과 (R17). `action`에 "다시 분석" 안내 |
| 429 | `rate_limited` | 접속 출처당 일일 요청 한도 도달 (FR-034) |
| 503 | `daily_budget_exhausted` | 서비스 일일 비용 상한 도달 (R5) |
| 500 | `internal_error` | 그 외 |

### 공용 타입

```ts
type Level = "beginner" | "vibe_coder" | "developer";
type Purpose = "understand" | "setup" | "modify";
type AnalysisStatus = "queued" | "running" | "completed" | "partial" | "failed" | "expired";
type AnalysisStage =
  | "queued" | "validating_repo" | "scanning_structure" | "selecting_files"
  | "reading_files" | "exploring_more" | "writing_manual" | "done";

type RepoRef = {
  owner: string;
  name: string;
  ref: string | null;          // 해석된 브랜치/태그 (해석 전 null)
  commitSha: string | null;    // 고정된 커밋 (해석 전 null)
  subpath: string | null;
  htmlUrl: string;             // https://github.com/{owner}/{name}
};

type AnalysisSummary = {
  id: string;                  // uuid, 공유 링크 /a/{id}
  repo: RepoRef;
  level: Level;
  purpose: Purpose;
  status: AnalysisStatus;
  createdAt: string;           // ISO 8601
  finishedAt: string | null;
};
```

## 엔드포인트

### `POST /api/analyses` — 분석 시작 (US1)

요청:

```ts
{ repoUrl: string; level: Level; purpose: Purpose }
```

응답 `202 Accepted`:

```ts
{ id: string; status: "queued" | "running"; deduplicated: boolean }
```

- URL 형식 검증은 `shared`의 파서로 동기 수행한다. 저장소 존재 여부와 공개 여부는 워커의
  `validating_repo` 단계에서 확인하고, 결과는 `failed(repo_not_found_or_private)`로 나타난다(US3 #2).
- 같은 저장소·ref·수준·목적의 진행 중 분석이 있으면 그 ID를 `deduplicated: true`로 반환한다.
  이 경우 요청 수에 포함하지 않는다.
- 오류: `400 invalid_url`, `400 invalid_request`, `429 rate_limited`, `503 daily_budget_exhausted`

### `GET /api/analyses/{id}` — 진행 상태·결과 개요 (폴링 대상, US1·US3·US4)

응답 `200`:

```ts
{
  ...AnalysisSummary;
  stage: AnalysisStage;
  progress: {
    round: number; maxRounds: number; filesRead: number; filesPlanned: number;
    activity: "reading_files" | "llm_deciding" | "llm_writing" | "llm_retry_wait" | "validating_citations" | null;
    updatedAt: string;           // 실행 중 10초 이하 간격으로 갱신 (research R11)
  };
  queuePosition: number | null;  // status=queued일 때만: 먼저 생성된 queued 분석 수 + 1
  failure: {
    code: FailureCode; message: string; action: string;
    retryAfterSec: number | null;  // rate-limit 계열 실패만 값이 있음 (failure_retry_at 기반)
  } | null;                                                                    // status=failed
  partialReasons: { code: PartialReason; message: string }[];                  // status=partial
  hasManual: boolean;
  expiresAt: string;
  parentId: string | null;
  regenerationMode: "change_options" | "refresh_commit" | null;
  versions: AnalysisSummary[];   // 같은 root의 분석 목록, 생성순 (FR-033)
}
```

- 클라이언트는 `status`가 `queued` 또는 `running`인 동안 2초 간격으로 폴링한다(R11).
- 오류: `404 not_found`, `410 expired`

### `GET /api/analyses/{id}/manual` — 매뉴얼 본문 (US1·US2)

응답 `200`: `Manual` 문서 ([manual.md](./manual.md))

- `status`가 `completed` 또는 `partial`일 때만 반환한다. 나머지 상태는 `409 not_ready`다.
- 오류: `404 not_found`, `409 not_ready`, `410 expired`

### `GET /api/analyses/{id}/trace` — 분석 내역 (FR-027, US2 #3)

응답 `200`:

```ts
{
  repo: RepoRef;
  detectedStack: { languages: string[]; packageManagers: string[]; frameworkHints: string[]; manifests: string[] };
  treeStats: { entryCount: number; candidateCount: number; truncated: boolean };
  limits: Record<string, number>;          // 적용된 한도 스냅샷
  usage: {
    rounds: number; filesRead: number; githubCalls: number;
    inputTokens: number; outputTokens: number; thoughtTokens: number;
    costUsd: number; usageEstimated: boolean;
  };
  stopReason: StopReason | null;
  limitReached: boolean;
  decisions: {
    decideNo: number;
    sufficient: boolean;
    coverage: { sectionId: string; status: "covered" | "partial" | "missing"; note: string }[];
    requests: { path: string; reason: string; accepted: boolean; rejectReason: string | null }[];
    expandedDirectories: string[];
  }[];
  files: {
    path: string; roundNo: number; source: "seed" | "llm_request" | "reused";
    reason: string; sizeBytes: number; truncated: boolean;
    contentIncludedInWrite: boolean;
    githubUrl: string;                     // 커밋 고정 퍼머링크
  }[];
}
```

- 실행 중에도 지금까지의 기록을 반환한다.
- 오류: `404 not_found`, `410 expired`

### `GET /api/analyses/{id}/freshness` — 새 커밋 확인 (US4 #4, US5 #2)

응답 `200`:

```ts
{ analyzedCommitSha: string; latestCommitSha: string; isOutdated: boolean; checkedAt: string }
```

- 같은 저장소·ref 조합의 결과는 서버에서 5분간 캐시한다.
- 오류: `404 not_found`, `409 not_ready`(커밋 미고정)

### `POST /api/analyses/{id}/regenerations` — 매뉴얼 재생성 (US5)

요청:

```ts
| { mode: "change_options"; level?: Level; purpose?: Purpose }   // 하나 이상 부모와 달라야 함
| { mode: "refresh_commit" }                                     // 새 커밋이 있어야 함
```

응답 `202 Accepted`:

```ts
{ id: string; status: "queued" }
```

- 부모는 `completed` 또는 `partial`이어야 한다. 새 분석은 부모와 같은 `root`에 속한다.
- 접속 출처당 요청 한도와 일일 예산 검사를 똑같이 적용한다.
- 오류: `400 invalid_request`, `404 not_found`, `409 parent_not_finished`, `409 already_latest`,
  `410 expired`, `429 rate_limited`, `503 daily_budget_exhausted`

### `GET /api/analyses?ids={id1,id2,...}` — 최근 목록 상태 일괄 조회 (US4 #2)

- `ids`는 쉼표로 구분한 UUID이며 최대 20개다.

응답 `200`:

```ts
{ items: AnalysisSummary[]; missingIds: string[] }   // 삭제·만료·존재하지 않는 ID는 missingIds
```

### `GET /api/health`

응답 `200`: `{ ok: true; db: "ok" }`. DB에 연결할 수 없으면 `503`과 `{ ok: false; db: "error" }`

## 사용자 메시지 매핑 (FR-028)

`failure.message`와 `failure.action`은 백엔드가 `failure_code`별 고정 문구(한국어)로 채운다.
LLM이 생성하지 않는다.

| `failure_code` | 메시지 요지 | 조치 요지 |
|----------------|-------------|-----------|
| `repo_not_found_or_private` | 저장소를 찾을 수 없거나 비공개 저장소입니다. 공개 저장소만 지원합니다 | URL 확인, 공개 여부 확인 |
| `repo_empty` | 저장소에 커밋이 없습니다 | 다른 저장소 시도 |
| `ref_not_found` | URL의 브랜치·태그를 찾을 수 없습니다 | 기본 브랜치 URL로 다시 시도 |
| `no_analyzable_files` | 분석할 수 있는 텍스트 파일이 없습니다 | — |
| `limit_reached` | 분석 한도 안에서 매뉴얼을 만들 수 없었습니다 | 하위 경로 URL로 범위를 좁혀 다시 시도 |
| `github_rate_limited` | GitHub 사용량 제한에 걸렸습니다 | `retryAfterSec` 후 다시 시도 |
| `github_unavailable` / `llm_unavailable` | 외부 서비스가 일시적으로 응답하지 않습니다 | 잠시 후 다시 시도 |
| `llm_rate_limited` | AI 서비스 사용량 제한에 걸렸습니다 | 잠시 후 다시 시도 |
| `manual_generation_failed` | 매뉴얼 생성 결과가 올바르지 않아 완성하지 못했습니다 | 다시 시도 |
| `timeout` | 분석 시간이 상한을 넘었습니다 | 하위 경로로 범위를 좁혀 다시 시도 |
| `internal_error` | 알 수 없는 오류가 발생했습니다 | 잠시 후 다시 시도 |

`partial_reasons`도 같은 방식으로 고정 문구를 쓴다. 예: `repo_too_large`는 "저장소가 커서 일부
디렉터리만 분석했습니다"로 표시한다.
