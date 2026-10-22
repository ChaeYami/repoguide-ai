# Data Model: Agentic 개인 맞춤 저장소 매뉴얼 생성

**Feature**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Date**: 2026-10-22

저장소는 Supabase Postgres다. 모든 시각은 `timestamptz`(UTC)로 저장한다. 모든 테이블은 RLS를
활성화하되 정책을 만들지 않는다(research R12). 매뉴얼 본문과 LLM 판단 결과는 zod로 검증된 JSONB로
저장한다. 스펙의 엔티티 "설명 항목"과 "근거 참조"는 `manuals.sections` JSON 안의 구조로 표현한다.
JSON 구조는 [contracts/manual.md](./contracts/manual.md)에 정의한다.

## Enum

| 이름 | 값 | 출처 |
|------|----|------|
| `level` | `beginner`(입문자), `vibe_coder`(바이브 코딩 개발자), `developer`(일반 개발자) | FR-003 |
| `purpose` | `understand`(프로젝트 이해), `setup`(설치 및 실행), `modify`(코드 수정 및 확장) | FR-004 |
| `analysis_status` | `queued`, `running`, `completed`, `partial`, `failed`, `expired` | FR-028, R17 |
| `analysis_stage` | `queued`, `validating_repo`, `scanning_structure`, `selecting_files`, `reading_files`, `exploring_more`, `writing_manual`, `done` | FR-018 |
| `regeneration_mode` | `change_options`, `refresh_commit` | FR-032 |
| `failure_code` | `invalid_url`, `repo_not_found_or_private`, `repo_empty`, `ref_not_found`, `no_analyzable_files`, `limit_reached`, `github_rate_limited`, `github_unavailable`, `llm_rate_limited`, `llm_unavailable`, `manual_generation_failed`, `timeout`, `internal_error` | FR-028 |
| `partial_reason` | `round_limit`, `file_limit`, `cost_limit`, `token_limit`, `github_call_limit`, `timeout`, `repo_too_large`, `content_trimmed` | FR-013, Edge Cases |
| `stop_reason` | `sufficient`, `no_more_candidates`, `round_limit`, `file_limit`, `cost_limit`, `token_limit`, `github_call_limit`, `timeout` | R1 |
| `file_source` | `seed`(코드 시드), `llm_request`(Decide 요청), `reused`(재생성 시 재사용) | FR-011 |
| `request_reject_reason` | `not_in_tree`, `not_a_file`, `excluded`, `too_large`, `already_read`, `over_round_limit`, `over_file_limit`, `budget` | R1 |

## 테이블

### `repo_snapshots` — 저장소 스냅샷 (특정 커밋 시점)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | uuid | PK, default `gen_random_uuid()` | |
| `owner` | text | not null | 소문자로 정규화 |
| `name` | text | not null | 소문자로 정규화 |
| `commit_sha` | text | not null, 40자 hex | 고정된 커밋 (FR-017) |
| `ref` | text | not null | 해석된 브랜치·태그(없으면 기본 브랜치) |
| `default_branch` | text | not null | |
| `description` | text | null | |
| `primary_language` | text | null | |
| `tree_entry_count` | int | not null | 필터 전 항목 수 |
| `candidate_count` | int | not null | 필터 후 읽기 후보 수 |
| `tree_truncated` | boolean | not null | GitHub 트리 응답이 잘렸는지 (→ `repo_too_large`) |
| `candidates` | jsonb | not null | 필터 후 후보 `[{path, size, blobSha}]` |
| `detected_stack` | jsonb | not null | `{languages[], packageManagers[], frameworkHints[], manifests[]}` |
| `created_at` | timestamptz | not null, default now() | |

- 고유: `(owner, name, commit_sha)`. 같은 커밋은 여러 분석에서 재사용한다.
- 검증: `commit_sha`는 `^[0-9a-f]{40}$` 형식이어야 한다. `candidates`는 최대 100,000개다.

### `snapshot_files` — 파일 원문 캐시

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | uuid | PK | |
| `snapshot_id` | uuid | FK → repo_snapshots, on delete cascade | |
| `path` | text | not null | 저장소 루트 기준 정규화 경로 |
| `blob_sha` | text | not null | |
| `size_bytes` | int | not null | |
| `content` | text | null | 바이너리로 판정되면 null |
| `line_count` | int | not null | 전달된(잘린 경우 잘린 후) 줄 수. 인용 검증 기준 (R8) |
| `truncated` | boolean | not null | `LIMIT_MAX_CHARS_PER_FILE` 적용 여부 |
| `skipped_reason` | text | null | `binary` 등 |
| `fetched_at` | timestamptz | not null | |

- 고유: `(snapshot_id, path)`

### `analyses` — 분석 요청 (작업 큐 겸 공유 링크 단위)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | uuid | PK, default `gen_random_uuid()` | 공유 링크 `/a/{id}` (FR-030) |
| `root_analysis_id` | uuid | not null, FK → analyses | 최초 분석이면 자기 자신. 버전 묶음 기준 |
| `parent_analysis_id` | uuid | null, FK → analyses | 재생성 원본 |
| `regeneration_mode` | regeneration_mode | null | 재생성일 때만 값이 있음 |
| `repo_owner` / `repo_name` | text | not null | 정규화된 값 |
| `requested_ref` | text | null | URL에 포함된 ref 원문 |
| `subpath` | text | null | URL의 하위 경로 (우선 탐색 범위) |
| `snapshot_id` | uuid | null, FK → repo_snapshots | `scanning_structure` 이후 설정 |
| `level` | level | not null | |
| `purpose` | purpose | not null | |
| `status` | analysis_status | not null, default `queued` | |
| `stage` | analysis_stage | not null, default `queued` | |
| `progress` | jsonb | not null | `{round, maxRounds, filesRead, filesPlanned, activity, updatedAt}`. 실행 중 10초 이하 간격 하트비트 (research R11) |
| `stop_reason` | stop_reason | null | |
| `failure_code` | failure_code | null | `status=failed`일 때 필수 |
| `failure_retry_at` | timestamptz | null | rate-limit 계열 실패(`github_rate_limited`, `llm_rate_limited`)의 재시도 가능 시각 |
| `partial_reasons` | jsonb | not null, default `[]` | `partial_reason[]`. `status=partial`이면 1개 이상 |
| `limits` | jsonb | not null | 실행 시작 시점의 한도 스냅샷 (R5) |
| `usage` | jsonb | not null | `{rounds, filesRead, githubCalls, inputTokens, outputTokens, thoughtTokens, costUsd, usageEstimated}` |
| `reserved_cost_usd` | numeric(10,4) | not null | 일일 예산 예약액 (R5). 종료 시 0 |
| `prompt_version` | text | not null | 프롬프트 템플릿 버전 (평가 비교용) |
| `client_key_hash` | text | not null | `sha256(ip + salt)` (R16) |
| `lease_owner` | text | null | 워커 식별자 |
| `lease_expires_at` | timestamptz | null | |
| `attempt_count` | int | not null, default 0 | 최대 2 |
| `created_at` | timestamptz | not null | |
| `started_at` / `finished_at` | timestamptz | null | |
| `expires_at` | timestamptz | not null | `created_at + RETENTION_DAYS` |

인덱스:
- `(status, created_at)`: 작업 획득
- `(client_key_hash, created_at)`: 요청 제한
- `(root_analysis_id, created_at)`: 버전 목록
- `(repo_owner, repo_name, requested_ref, level, purpose) where status in ('queued','running')`:
  중복 요청 확인
- `(expires_at)`: 만료 정리

검증 규칙:
- `status=failed`이면 `failure_code`가 not null이어야 한다. `status=partial`이면 `partial_reasons`가
  비어 있지 않아야 한다.
- `regeneration_mode`가 not null이면 `parent_analysis_id`도 not null이어야 한다.
- `change_options`는 부모와 `snapshot_id`가 같아야 하고, `level` 또는 `purpose` 중 하나 이상이
  달라야 한다.
- `usage.costUsd`는 `limits.maxCostUsdPerRun` 이하여야 한다. 이 불변식은 테스트로 검증한다(SC-008).

### `exploration_rounds` — 탐색 판단 기록 (Constitution I·II)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | uuid | PK | |
| `analysis_id` | uuid | FK → analyses, on delete cascade | |
| `decide_no` | int | not null, 1..maxRounds | Decide 호출 순번 |
| `model` | text | not null | |
| `input_file_paths` | jsonb | not null | 이번 호출에 원문으로 전달한 파일 |
| `requests` | jsonb | not null | `[{path, reason, accepted, rejectReason?}]` |
| `expanded_directories` | jsonb | not null | `[path]` |
| `coverage` | jsonb | not null | `[{sectionId, status: covered/partial/missing, note}]` |
| `file_notes` | jsonb | not null | `[{path, summary, facts[{text, startLine, endLine}]}]` |
| `sufficient` | boolean | not null | |
| `usage` | jsonb | not null | `{inputTokens, outputTokens, thoughtTokens, costUsd, usageEstimated}` |
| `created_at` | timestamptz | not null | |

- 고유: `(analysis_id, decide_no)`

### `explored_files` — 분석 작업 집합 (FR-011, FR-027)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `analysis_id` | uuid | FK → analyses, on delete cascade | |
| `snapshot_file_id` | uuid | FK → snapshot_files | |
| `path` | text | not null | |
| `round_no` | int | not null | 0 = 재사용, 1.. = 읽은 라운드 |
| `source` | file_source | not null | |
| `reason` | text | not null | 선택 이유 (시드면 코드 규칙명, 요청이면 LLM 이유) |
| `content_included_in_write` | boolean | not null | Write에 원문을 전달했는지 (`content_trimmed` 판정) |

- PK: `(analysis_id, path)`
- 인용 검증(R8)의 기준 집합이다. 근거는 반드시 이 테이블에 있는 행의 `path`를 가리켜야 한다.

### `manuals` — 생성된 매뉴얼

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | uuid | PK | |
| `analysis_id` | uuid | unique, FK → analyses, on delete cascade | 분석 요청 1개당 매뉴얼 1개 |
| `level` / `purpose` | enum | not null | |
| `document` | jsonb | not null | 검증·조립이 끝난 Manual JSON ([contracts/manual.md](./contracts/manual.md)) |
| `stats` | jsonb | not null | `{blocks, facts, inferences, evidenceKept, evidenceDropped, downgraded, sectionsNotFound}` |
| `model` | text | not null | |
| `usage` | jsonb | not null | Write 호출 사용량 |
| `created_at` | timestamptz | not null | |

## 상태 전이

### `analyses.status`

```text
            ┌────────────── 임대 만료 + attempt_count < 2 (재시도) ─────────────┐
            ▼                                                                    │
 [queued] ──워커 획득──▶ [running] ──┬─ 모든 필수 섹션 처리, 한도 미도달 ──▶ [completed]
                                     ├─ 한도 도달 & 일부 섹션 부족, 또는 트리 잘림, 또는 원문 축소 ──▶ [partial]
                                     └─ 복구 불가 오류 / attempt_count 초과 ──▶ [failed]
 [completed | partial | failed] ──expires_at 경과(정리 작업)──▶ [expired]
```

- `completed`와 `partial`만 매뉴얼을 가진다. `failed`는 `failure_code`와 사용자 안내만 가진다.
- `partial` 판정은 코드가 한다(R1).
  - `stop_reason`이 한도 계열이고 Write 결과에 `partial` 또는 `not_found` 섹션이 있으면 해당 한도를
    `partial_reasons`에 넣는다.
  - `tree_truncated`이면 `repo_too_large`를 넣는다.
  - Write 원문을 줄였으면 `content_trimmed`를 넣는다.
- 저장소에 정보가 없어 생긴 `not_found` 섹션만 있고 한도에 도달하지 않았다면 `completed`다(US2 #4).

### `analyses.stage` (status=running 동안)

```text
validating_repo → scanning_structure → selecting_files → reading_files → (exploring_more)* → writing_manual → done
```

| stage | 화면 표시 | 수행 주체 |
|-------|-----------|-----------|
| `validating_repo` | 저장소 확인 | 코드: URL 해석, 공개 여부, ref 해석, 커밋 고정 |
| `scanning_structure` | 구조 파악 | 코드: 트리 수집·필터, 스택 감지, 시드 결정 |
| `selecting_files` | 파일 선택 | LLM Decide #1 + 코드 요청 검증 |
| `reading_files` | 파일 분석 | 코드: Round 1 읽기 → LLM Decide #2 |
| `exploring_more` | 추가 탐색 (n/최대) | 코드: Round 2·3 읽기 → LLM Decide #3 |
| `writing_manual` | 매뉴얼 작성 | LLM Write + 코드 인용 검증·조립 |

- 재생성 `change_options`는 `validating_repo`와 `scanning_structure`를 건너뛴다. 스냅샷을
  재사용하고 `selecting_files`부터 시작한다.

## 엔티티 관계

```text
repo_snapshots 1 ──< snapshot_files
repo_snapshots 1 ──< analyses >── 0..1 analyses(parent)        analyses >── 1 analyses(root)
analyses 1 ──< exploration_rounds
analyses 1 ──< explored_files >── 1 snapshot_files
analyses 1 ── 0..1 manuals
```

## 스펙 엔티티 매핑

| 스펙 엔티티 | 구현 |
|-------------|------|
| 분석 요청 | `analyses` |
| 저장소 스냅샷 | `repo_snapshots` (+ 원문 캐시 `snapshot_files`) |
| 분석 파일 기록 | `explored_files` (+ 판단 근거 `exploration_rounds`) |
| 매뉴얼 | `manuals` |
| 설명 항목 | `manuals.document.sections[].blocks[]` |
| 근거 참조 | `manuals.document.sections[].blocks[].evidence[]` |
