---

description: "Task list for Agentic 개인 맞춤 저장소 매뉴얼 생성"
---

# Tasks: Agentic 개인 맞춤 저장소 매뉴얼 생성

**Input**: Design documents from `/specs/001-repo-manual-generator/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md), [research.md](./research.md), [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: 사용자 요청에 따라 **테스트는 해당 기능을 구현하는 작업 안에 포함**한다. 각 작업의
"검증" 항목이 통과해야 완료다. 결정적 코드는 Constitution III에 따라 자동화 테스트가 필수다.
`npm test`는 외부 서비스(GitHub, Gemini, DB) 없이 통과해야 한다. DB 테스트는 `npm run test:db`로
분리한다(`TEST_DATABASE_URL`).

**Organization**: Setup → Foundational → 사용자 스토리(US1~US5, spec 우선순위 순) →
통합·검증 → 조건부 확장(Knowledge & Retrieval) 순서로 진행한다.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: 같은 Phase 안에서 다른 파일을 다루고, 아직 끝나지 않은 작업에 의존하지 않아 병렬로 진행할
  수 있다
- **[Story]**: 사용자 스토리 (US1~US5). Setup, Foundational, 통합·검증, 조건부 확장 Phase에는 붙이지
  않는다
- 각 작업의 하위 항목은 다음과 같다.
  - **의존**: 먼저 끝나야 하는 작업
  - **완료 조건**: 무엇이 갖춰져야 끝나는가
  - **검증**: 어떤 명령이나 절차로 확인하는가
  - **관련**: 요구사항 ID와 설계 문서 위치

## 구현 영역 → Phase 매핑

| 영역 | 위치 |
|------|------|
| A. Project Setup | Phase 1 (T001~T006) |
| B. Database Foundation | Phase 2 (T009~T010) |
| C. GitHub Repository Ingestion | Phase 2 (T008, T012~T015) + US3 엣지 케이스 (T034) + US5 최신 커밋 확인 (T042) |
| D. Agentic Analysis | Phase 2 (T016~T017) + US1 (T018~T021, T024) + US5 재사용 (T044) |
| E. Knowledge and Retrieval | 근거 연결·검증: US1 (T022), US2 (T030~T032). 청크·임베딩·pgvector 검색·엔티티·Wiki: **Phase 9 조건부 확장** (T053~T060) |
| F. Manual Generation | US1 (T022~T025) + US5 재생성·재분석·결과 재사용 (T043~T044) |
| G. Frontend | US1 (T026~T028) + US2 (T031) + US3 (T036) + US4 (T039~T040) + US5 (T045) |
| H. Integration and Verification | 각 스토리 검증 작업 (T029, T032, T037, T041, T046) + Phase 8 (T047~T052) |

## 🔗 연결 지점 (UI · API · Agentic 분석 · DB가 처음 이어지는 시점)

| # | 연결 | 작업 | 확인 방법 |
|---|------|------|-----------|
| ① | Backend ↔ Supabase DB | T011 | `npm run dev` 후 `GET /api/health` → `{"ok":true,"db":"ok"}` |
| ② | 수집 코드 ↔ 실제 GitHub API | T015 | `npm run dev:ingest -- <url>` → 커밋 SHA, 후보 수, 시드 파일 출력 |
| ③ | LLM 어댑터 ↔ 실제 Gemini API | T016 | `npm run llm:ping` → 두 모델의 구조화 응답과 usage 출력 |
| ④ | Agentic 파이프라인 ↔ DB ↔ GitHub ↔ Gemini (워커) | T024 | `npm run dev:analyze -- <url> --level beginner --purpose setup` → DB에 분석·매뉴얼 저장 |
| ⑤ | REST API ↔ 파이프라인·DB | T025 | `curl`로 `POST /api/analyses` → `GET /api/analyses/{id}` 폴링 → `GET .../manual` |
| ⑥ | UI ↔ API (전체 흐름) | T028 → T029 | 브라우저에서 URL 입력 → 진행 화면 → 매뉴얼 표시 |

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: 모노레포, TypeScript, 개발 도구, 환경 변수, 로컬 실행 환경 (영역 A)

- [X] T001 루트 모노레포를 구성한다: `package.json`(npm workspaces `shared`, `backend`, `frontend`), `tsconfig.base.json`, `.gitignore`, `.nvmrc`
  - 의존: 없음. 사전 준비로 `git init`을 권장한다(quickstart 1.4).
  - 완료 조건:
    - `tsconfig.base.json`: `strict: true`, ES2023 타깃
    - `.gitignore`: `.env`, `node_modules`, `dist`, `coverage`
    - `.nvmrc` 값 `24`, `engines.node >=24`
    - 루트 스크립트: `dev`, `build`, `start`, `test`, `test:db`, `typecheck`, `lint`, `format`, `db:generate`, `db:migrate`, `dev:ingest`. 나머지(`llm:ping`, `dev:analyze`, `eval`)는 실행 파일이 생기는 T016·T024·T047에서 추가한다(빈 스크립트를 미리 두지 않음).
  - 검증: `npm install` 성공, `git check-ignore .env` 출력이 `.env`
  - 관련: plan.md Project Structure, research R20

- [X] T002 [P] `shared` 패키지를 초기화한다: `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`, `shared/src/index.ts`
  - 의존: T001
  - 완료 조건: zod 4 의존성 추가, ESM 빌드 산출물을 `backend`와 `frontend`가 workspace 의존성으로 import할 수 있다
  - 검증: `npm run build -w shared`, `npm run typecheck -w shared` 성공
  - 관련: research R20

- [X] T003 [P] `backend` 패키지를 초기화한다: `backend/package.json`, `backend/tsconfig.json`, `backend/vitest.config.ts`
  - 의존: T001
  - 완료 조건:
    - 의존성 설치: `fastify@5`, `@fastify/static`, `zod`, `@google/genai@^2.3.0`, `drizzle-orm`, `postgres`, 개발 의존성 `drizzle-kit`, `tsx`, `vitest`
    - `dev` 스크립트(`tsx watch src/index.ts`)와 `build`(tsc) 정의
  - 검증: `npm run typecheck -w backend`, `npm test -w backend` 실행 성공. 아직 테스트 파일이 없어도 러너가 정상 종료해야 한다.
  - 관련: plan.md Technical Context, research R3, R12, R18

- [X] T004 [P] `frontend` 패키지를 초기화한다: `frontend/package.json`, `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/main.tsx`, `frontend/src/App.tsx`, `frontend/src/styles/index.css`
  - 의존: T001
  - 완료 조건:
    - 구성: React 19, Vite, Tailwind CSS v4(`@tailwindcss/vite`), React Router, TanStack Query, `react-markdown`, Vitest + React Testing Library + jsdom
    - `vite.config.ts`에서 `/api`를 `http://localhost:8787`로 프록시한다
    - `App.tsx`에 `/`, `/a/:id`, `*` 라우트 골격을 두고, 각 페이지는 제목만 표시한다
  - 검증: `npm run dev -w frontend` 후 `http://localhost:5173` 렌더링 확인, `npm run build -w frontend` 성공
  - 관련: research R19

- [X] T005 개발 도구와 로컬 실행 환경을 구성한다: 루트 `eslint.config.js`, `.prettierrc`, 루트 `package.json`의 `dev`, `lint`, `typecheck`, `test` 스크립트
  - 의존: T002, T003, T004
  - 완료 조건:
    - typescript-eslint와 Prettier를 적용한다
    - `npm run dev`가 `concurrently`로 백엔드(8787)와 프론트(5173)를 동시에 실행한다
    - `npm test`와 `npm run typecheck`가 세 workspace를 모두 실행한다
  - 검증: `npm run lint`, `npm run typecheck` 통과, `npm run dev`로 두 서버 기동 확인
  - 관련: research R22

- [X] T006 환경 변수 설정과 한도 구성을 구현하고 테스트한다: `.env.example`, `backend/src/config/env.ts`, `backend/src/config/limits.ts`, `backend/tests/unit/config.test.ts`
  - 의존: T003
  - 완료 조건:
    - `.env.example`(작성 완료): quickstart 2장의 모든 변수를 담는다. 필수 값은 비워 두고 선택 값은 기본값을 주석으로 둔다. `env.ts`·`limits.ts`의 기본값과 일치해야 한다
    - `env.ts`는 zod로 모든 변수와 기본값을 검증하고, 필수 값은 **진입점마다 필요한 것만** 요구한다(서버: `DATABASE_URL`, `dev:ingest`: 없음 → T016·T024·T025에서 `GEMINI_API_KEY`·`GITHUB_TOKEN`·`CLIENT_KEY_SALT` 추가). 누락 시 **변수 이름만** 나열하고 값은 출력하지 않은 채 종료한다. `DATABASE_URL`에 `[YOUR-PASSWORD]`가 남았거나 6543 포트면 바로 알린다.
    - `limits.ts`는 research R5 표의 기본값을 쓰고 `LIMIT_*`, `LLM_MAX_OUTPUT_*`로 덮어쓰며, `Limits` 타입으로 노출한다
  - 검증: `npm test -w backend -- config` 통과. 테스트 항목: 필수 누락 오류 메시지, 비밀값 미노출, 기본값 적용, 숫자 파싱 오류.
  - 관련: Constitution VI, research R5, quickstart 2장

**Checkpoint**: `npm install`, `npm run dev`, `npm run lint`, `npm run typecheck`, `npm test`가 모두 동작한다.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: 공유 스키마, DB 기반(B), GitHub 수집(C), LLM 어댑터, 작업 워커. 모든 사용자 스토리가 여기에 의존한다.

**⚠️ CRITICAL**: 이 Phase가 끝나기 전에는 사용자 스토리 작업을 시작하지 않는다

### 공유 도메인

- [X] T007 [P] 공유 도메인 스키마를 구현하고 테스트한다: `shared/src/enums.ts`, `shared/src/sections.ts`, `shared/src/manual.ts`, `shared/src/api.ts`, `shared/tests/schemas.test.ts`
  - 의존: T002
  - 완료 조건:
    - `enums.ts`: data-model.md Enum 표의 값을 **그대로** 정의한다(`level`, `purpose`, `analysis_status`, `analysis_stage`, `regeneration_mode`, `failure_code`, `partial_reason`, `stop_reason`, `file_source`, `request_reject_reason`)
    - `sections.ts`: contracts/manual.md 섹션 카탈로그(목적별 SectionId 순서, 한국어 제목, 작성 지침)
    - `manual.ts`: `Manual` zod 스키마
    - `api.ts`: contracts/http-api.md의 요청·응답·`ErrorResponse`·`ErrorCode` zod 스키마
  - 검증: `npm test -w shared` 통과. 테스트 항목: 계약 예시 통과, 잘못된 enum 거부, 카탈로그 순서가 계약 표와 일치.
  - 관련: FR-003, FR-004, FR-020, data-model.md, contracts/

- [X] T008 [P] GitHub URL 파서를 구현하고 테스트한다: `shared/src/repo-url.ts`, `shared/tests/repo-url.test.ts`
  - 의존: T002
  - 완료 조건:
    - 허용 형식: 저장소 기본 주소, `.git` 접미사, `www.` 유무, 끝 슬래시, 스킴 생략(`github.com/o/r`), `/tree/{...}`와 `/blob/{...}` 경로
    - 정규화: owner와 name을 소문자로 만든다
    - 검증 규칙: owner `[A-Za-z0-9-]{1,39}`, repo `[A-Za-z0-9._-]{1,100}`
    - `/tree/` 이후 세그먼트는 ref·하위 경로 **후보 목록**으로 반환한다. 실제 해석은 T013에서 한다.
    - 오류는 `invalid_url`과 올바른 형식 예시를 함께 반환한다
  - 검증: `npm test -w shared -- repo-url` 통과. 표 기반 20개 이상 사례이며 quickstart V7 입력(`https://gitlab.com/a/b`, `github.com/onlyowner`)을 포함한다.
  - 관련: FR-001, FR-002, Edge Cases(URL 변형), research R6

### Database Foundation (B)

- [X] T009 Supabase 연결, 스키마, 마이그레이션을 구현한다: `backend/src/db/client.ts`, `backend/src/db/schema.ts`, `backend/drizzle.config.ts`, `backend/drizzle/*.sql`
  - 의존: T003, T006, T007
  - 완료 조건:
    - `client.ts`: postgres.js 연결 풀(Direct 또는 Session pooler 5432)과 종료 처리
    - `schema.ts`: data-model.md의 테이블 6개, enum, 인덱스를 정의한다. 아래 제약을 **그대로** 반영한다.
      - `repo_snapshots`: 고유 `(owner, name, commit_sha)`, `commit_sha`는 `^[0-9a-f]{40}$` 형식(check)
      - `snapshot_files`: 고유 `(snapshot_id, path)`, `snapshot_id` on delete cascade
      - `analyses`:
        - `status` default `queued`, `stage` default `queued`, `attempt_count` default 0, `reserved_cost_usd numeric(10,4)`, `expires_at not null`
        - check: `status=failed`이면 `failure_code`가 not null
        - check: `status=partial`이면 `partial_reasons`가 비어 있지 않음
        - check: `regeneration_mode`가 not null이면 `parent_analysis_id`도 not null
        - 인덱스 `(status, created_at)`, `(client_key_hash, created_at)`, `(root_analysis_id, created_at)`, `(expires_at)`
        - 부분 인덱스 `(repo_owner, repo_name, requested_ref, level, purpose) where status in ('queued','running')`
      - `exploration_rounds`: 고유 `(analysis_id, decide_no)`
      - `explored_files`: PK `(analysis_id, path)`
      - `manuals`: `analysis_id` unique
      - 하위 테이블은 모두 on delete cascade
    - 추가 SQL 마이그레이션: `CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;`, 모든 테이블 `ENABLE ROW LEVEL SECURITY`(정책 없음)
    - 루트 `db:generate`와 `db:migrate` 스크립트를 연결한다
  - 검증: 빈 Supabase 프로젝트에 `npm run db:migrate`가 성공하고, 재실행해도 변경이 없다. 대시보드 Table Editor에서 모든 테이블이 "RLS enabled"로 표시된다.
  - 관련: data-model.md, research R12, R13, quickstart 1.3

- [X] T010 기본 저장·조회 리포지토리와 계약 테스트를 구현한다: `backend/src/db/repositories/{analyses,snapshots,rounds,files,manuals,index}.ts`, `backend/tests/support/pglite-db.ts`, `backend/tests/contract/repositories.contract.ts`, `backend/tests/unit/repositories.pglite.test.ts`, `backend/tests/db/repositories.test.ts`
  - 의존: T009
  - 완료 조건:
    - 리포지토리: 분석 생성·조회·단계/진행 갱신·종료, 스냅샷 upsert, 파일 원문 upsert·조회, 라운드 기록, 작업 집합 기록, 매뉴얼 저장·조회
    - 구현 변경: 메모리 구현 대신 **PGlite(프로세스 안 Postgres + pgvector)** 를 쓴다. 실제 마이그레이션 SQL로 `npm test`에서 검증되고, 제약을 메모리 코드로 다시 구현할 필요가 없다. 같은 계약 테스트를 PGlite(`npm test`)와 실제 Postgres(`npm run test:db`)에 적용한다.
    - 파이프라인 테스트도 PGlite DB를 쓴다
  - 검증:
    - `npm test -w backend -- repositories.pglite`
    - `npm run test:db`(선택, `TEST_DATABASE_URL` 필요): 같은 계약 테스트, check 제약 위반 거부(실패인데 코드 없음, 부분인데 사유 없음), upsert 멱등성, cascade 삭제
    - **pgvector 검증**: `pg_extension`에 `vector`가 있고, `'[1,2,3]'::extensions.vector <-> '[1,2,4]'::extensions.vector` 거리 쿼리가 성공한다
    - **RLS 검증**: 모든 테이블의 `pg_class.relrowsecurity = true`
  - 관련: data-model.md, research R12, R13, R21

### API 골격

- [X] T011 Fastify 서버 골격, 오류 응답, 헬스 체크를 구현한다: `backend/src/api/server.ts`, `backend/src/api/routes/health.ts`, `backend/src/index.ts`, `backend/tests/unit/api-health.test.ts`
  - 의존: T006, T007, T010
  - 완료 조건:
    - 의존성을 주입받는 앱 팩토리를 만든다
    - zod 요청 검증 실패는 `400 invalid_request` `ErrorResponse`로 바꾼다
    - 처리되지 않은 오류는 `500 internal_error`로 응답하고 내부 상세를 내보내지 않는다(FR-029)
    - pino 로그에서 `authorization` 헤더와 키 값을 redact한다
    - 프로덕션에서는 `frontend/dist`를 정적 서빙하고, `/api`를 제외한 경로에 SPA fallback을 둔다
    - `index.ts`는 env → db → 서버 순으로 부트스트랩하고 graceful shutdown을 처리한다
  - 검증: `npm test -w backend -- api-health`(inject와 가짜 DB ping으로 200·503 확인). **🔗 연결 ①**: 실제 `.env`로 `npm run dev` 후 `GET /api/health` → `{"ok":true,"db":"ok"}`
  - 관련: contracts/http-api.md 공통, research R18

### GitHub Repository Ingestion (C)

- [X] T012 [P] GitHub 클라이언트와 API 한도·오류 처리를 구현한다: `backend/src/github/client.ts`, `backend/tests/unit/github-client.test.ts`, `backend/tests/fixtures/github/`
  - 의존: T003, T006
  - 완료 조건:
    - `fetch`를 주입받는다
    - 메서드: `getRepo`, `getCommitSha(ref)`(`Accept: application/vnd.github.sha`), `getTree(sha, recursive)`, `getFileRaw(path, sha)`(`Accept: application/vnd.github.raw+json`)
    - 헤더: Bearer 토큰, API 버전
    - 호출마다 실행별 카운터 콜백을 부른다(BudgetGuard 연동용)
    - 오류 매핑:
      - 404 또는 `private:true` → `repo_not_found_or_private`
      - 409 → `repo_empty`
      - 404/422(ref) → `ref_not_found`
      - 403/429이고 `x-ratelimit-remaining=0` → `github_rate_limited`, `retryAfterSec`는 `x-ratelimit-reset`으로 계산
      - 2차 한도(`retry-after`) → 1회 대기 후 재시도
      - 5xx·네트워크 오류 → 백오프로 2회 재시도 후 `github_unavailable`
    - 동시성을 6으로 제한한다
  - 검증: `npm test -w backend -- github-client` 통과. 상태 코드별 fixture 응답으로 모든 매핑을 확인한다.
  - 관련: FR-006, FR-028, Constitution 보안 제약, research R6

- [X] T013 ref 해석, 커밋 SHA 고정, 트리 수집을 구현한다: `backend/src/github/resolve-ref.ts`, `backend/tests/unit/resolve-ref.test.ts`
  - 의존: T008, T012
  - 완료 조건:
    - ref가 없으면 `default_branch`를 쓴다
    - `/tree/a/b/c` 후보는 `a` → `a/b` → `a/b/c` 순서로 최대 3회 커밋 조회해 처음 성공한 것을 ref로 쓰고, 나머지를 `subpath`로 쓴다
    - 고정한 커밋 SHA로 `recursive=1` 트리를 수집하고 `truncated` 값을 보존한다
  - 검증: `npm test -w backend -- resolve-ref` 통과. 사례: 기본 브랜치, 슬래시 포함 브랜치, 존재하지 않는 ref, 잘린 트리.
  - 관련: FR-017, Edge Cases(브랜치·하위 경로), research R6

- [X] T014 [P] 파일 제외 정책, 시드 선택, 스택 감지, 트리 목록 압축을 구현한다: `backend/src/github/{tree-filter,seeds,stack-detect,tree-listing}.ts`, `backend/tests/unit/{tree-filter,seeds,stack-detect,tree-listing}.test.ts`, `backend/tests/fixtures/trees/`
  - 의존: T007
  - 완료 조건:
    - research R7 규칙을 **그대로** 구현한다
      - 제외 디렉터리, 제외 확장자, `*.min.js`, `*.map`
      - 잠금 파일(스택 감지에만 사용)
      - `LIMIT_MAX_FILE_BYTES` 초과 파일 → `too_large`
    - 후보는 `[{path, size, blobSha}]` 형식이다
    - 시드는 최대 6개다: 루트 `README*`와 매니페스트, `subpath`가 있으면 그 경로를 우선한다
    - `detectedStack`은 `{languages[], packageManagers[], frameworkHints[], manifests[]}` 형식이다
    - LLM용 목록은 최대 2,000항목이고 `dir/ (N files)`로 접으며, `expandDirectories`로 펼칠 수 있다
    - 모두 I/O 없는 순수 함수다
  - 검증: `npm test -w backend -- tree-filter seeds stack-detect tree-listing` 통과. fixture는 Node 모노레포, Python, 문서 전용, 합성 10,000파일 트리다.
  - 관련: FR-007, FR-009, FR-010, Constitution I, research R7

- [X] T015 주요 파일 수집(파일 읽기)과 실제 GitHub 수집 스크립트를 구현한다: `backend/src/pipeline/file-reader.ts`, `backend/tests/unit/file-reader.test.ts`, `backend/scripts/dev-ingest.ts`
  - 의존: T010, T012, T013, T014
  - 완료 조건:
    - 커밋 SHA로 읽는다
    - 첫 8KB에 NUL 바이트가 있으면 `skipped_reason=binary`, `content=null`로 둔다
    - `LIMIT_MAX_CHARS_PER_FILE`에서 자르고 `truncated=true`, 자른 뒤 줄 수를 `line_count`로 저장한다
    - `snapshot_files`에 이미 있으면 재사용한다
    - 5개 파일마다 진행 콜백을 부른다
    - `dev-ingest.ts`는 URL 하나에 대해 저장소 확인 → ref 해석 → 트리 → 필터 → 시드 읽기를 실행하고 요약을 출력한다. LLM은 쓰지 않는다.
  - 검증: `npm test -w backend -- file-reader` 통과(바이너리, 절단, 캐시 재사용). **🔗 연결 ②**: `npm run dev:ingest -- https://github.com/<공개 저장소>` → 커밋 SHA, 후보 수, `detectedStack`, 시드 파일 줄 수 출력
  - 관련: FR-008, FR-016, FR-017, research R6, R7

### LLM 어댑터와 작업 관리 (D 기반)

- [X] T016 [P] LLM 어댑터, 가격표, 비용 계산을 구현한다: `backend/src/llm/client.ts`, `backend/src/llm/gemini-client.ts`, `backend/src/llm/cost.ts`, `backend/src/config/pricing.ts`, `backend/tests/support/fake-llm.ts`, `backend/tests/unit/{gemini-client,cost,pricing}.test.ts`, `backend/scripts/llm-ping.ts`
  - 의존: T003, T006
  - 완료 조건:
    - `LlmClient.generateStructured({role, model, systemInstruction, input, schema, maxOutputTokens, thinkingLevel})`를 정의한다
    - `GeminiClient` 요청 구성:
      - Interactions API `client.interactions.create`
      - `store: false`
      - `response_format`에 `z.toJSONSchema()` 결과
      - `temperature`를 보내지 않는다
    - `GeminiClient` 응답 처리:
      - zod 검증에 실패하면 오류 요약을 붙여 1회 재시도한다
      - 429와 5xx는 지수 백오프로 최대 3회 재시도하고, 끝내 실패하면 `llm_rate_limited`나 `llm_unavailable`이 된다
      - usage는 `total_input_tokens`, `total_output_tokens`, `total_thought_tokens`에서 추출한다. 입력이 0이면 추정치를 쓰고 `usageEstimated=true`로 둔다
    - `pricing.ts`는 적용 시작일이 있는 단가 목록이다
      - `gemini-3.5-flash-lite`: 입력 $0.30, 출력 $2.50
      - `gemini-3.8-flash`: 입력 $0.75, 출력 $3.75. **2027-01-01부터 $1.50 / $7.50**
    - `cost.ts`의 사전 추정은 `입력 문자/3 × 입력 단가 + 출력 상한 × 출력 단가`, 실비는 `입력 × 입력 단가 + (출력 + 사고) × 출력 단가`다
    - `FakeLlmClient`는 각본 응답을 돌려주고 호출을 기록한다
    - SDK 필드명은 구현 시 설치된 SDK 타입으로 확인한다(research R3)
  - 검증: `npm test -w backend -- gemini-client cost pricing` 통과. 항목: SDK mock으로 요청에 `store:false`가 있고 `temperature`가 없음, 스키마 재시도, 백오프, usage 추출, 날짜별 단가 전환. **🔗 연결 ③**: `npm run llm:ping` → 두 기본 모델 각각 작은 스키마의 구조화 응답과 usage 수치 출력
  - 관련: Constitution IV, VI, research R3, R4, contracts/llm-io.md 공통 규칙

- [X] T017 분석 작업 워커를 구현한다(획득·임대·하트비트·재시도·시간 상한): `backend/src/jobs/worker.ts`, `backend/src/index.ts`(워커 기동 연결), `backend/tests/unit/worker.test.ts`, `backend/tests/db/worker.test.ts`
  - 의존: T010, T011
  - 완료 조건:
    - `FOR UPDATE SKIP LOCKED`로 `queued`이거나 임대가 만료된 `running` 작업을 획득한다
    - 임대는 60초이고 20초마다 하트비트로 연장한다
    - 동시성은 `WORKER_CONCURRENCY`를 따른다
    - `attempt_count`가 최대 2를 넘으면 `failed(internal_error)`로 종료한다
    - `LIMIT_RUN_TIMEOUT_SEC`를 넘으면 핸들러에 중단 신호를 보낸다
    - 종료 시 진행 중 작업을 정리한다
    - 작업 처리 핸들러는 주입받는다. 실제 파이프라인은 T024에서 연결한다.
  - 검증: `npm test -w backend -- worker`(메모리 리포지토리로 루프·재시도 로직), `npm run test:db -- worker`(워커 2개가 같은 작업을 잡지 않음, 만료 임대 재획득, 시도 한도)
  - 관련: FR-019, research R10

**Checkpoint**: 연결 ①②③이 확인되었다. DB 스키마, 수집, LLM 어댑터, 워커가 각각 단독으로 테스트를 통과한다.

---

## Phase 3: User Story 1 - 저장소 URL로 맞춤 매뉴얼 생성 (Priority: P1) 🎯 MVP

**Goal**: URL, 수준, 목적을 입력하면 Agentic 탐색(동적 파일 선택 → 충분성 판단 → 조건부 추가 탐색)을 거쳐 근거가 연결된 맞춤 매뉴얼을 만들고, 진행 상태와 결과를 화면에 보여준다.

**Independent Test**: README가 빈약한 공개 저장소로 분석을 시작했을 때 다음을 확인한다(quickstart V1, V3, V4).
- 진행 단계가 갱신된다
- 완료 후 목적별 필수 섹션을 모두 갖춘다
- 수준별 설명 방식을 따른다
- 블록마다 확인됨/추론 표시와 GitHub 근거 링크가 있는 매뉴얼이 표시된다

### Agentic 분석 (D)

- [X] T018 [P] [US1] 탐색 예산과 종료 조건을 관리하는 BudgetGuard를 구현하고 테스트한다: `backend/src/pipeline/budget.ts`, `backend/tests/unit/budget.test.ts`
  - 의존: T006, T016
  - 완료 조건:
    - 실행 시작 시 한도를 스냅샷한다
    - 라운드, 파일, GitHub 호출, 입력·출력·사고 토큰, 비용을 누적한다
    - 판단 메서드: `canCallLlm(estimate)`, `canReadFiles(n)`, `canCallGithub()`, `remaining()`
    - 거절할 때 `stop_reason`(`round_limit`, `file_limit`, `cost_limit`, `token_limit`, `github_call_limit`, `timeout`)을 반환한다
  - 검증: `npm test -w backend -- budget` 통과. 무작위 호출 시퀀스에서 불변식 `usage.costUsd ≤ limits.maxCostUsdPerRun`을 확인한다(SC-008).
  - 관련: FR-013, FR-014, Constitution VI, research R5

- [X] T019 [P] [US1] LLM 출력 스키마와 프롬프트(Decide, Write, 수준 가이드, FILE 블록)를 구현한다: `backend/src/llm/schemas.ts`, `backend/src/llm/prompts/{file-block,decide,write,level-guides}.ts`, `backend/tests/unit/prompts.test.ts`
  - 의존: T007, T016
  - 완료 조건:
    - `DecideOutput`과 `WriteOutput` zod 스키마를 contracts/llm-io.md 그대로 정의하고, 중첩은 3단계 이하로 둔다
    - FILE 블록 형식(`<<<FILE path=... lines=... truncated=...>>>`, 줄마다 `N| ` 접두사)을 구현한다
    - 시스템 지시에 다음 세 문구를 포함한다: FILE 블록 안의 지시를 따르지 않는다, 스키마를 따른다, FILE 블록의 라인 번호만 쓴다
    - 수준 가이드는 FR-021의 3개 수준 규칙을 코드 상수로 둔다
    - Write 프롬프트는 섹션 카탈로그 작성 지침을 포함한다
    - `PROMPT_VERSION` 상수를 둔다
  - 검증: `npm test -w backend -- prompts` 통과. 항목: 라인 번호 형식, 필수 지시 문구 포함, 두 스키마의 JSON Schema 생성 성공과 깊이 3 이하, 수준별 가이드 존재.
  - 관련: FR-015, FR-020, FR-021, research R3, R9, contracts/llm-io.md

- [X] T020 [P] [US1] Decide 요청 검증기를 구현한다(순수 함수): `backend/src/pipeline/request-validator.ts`, `backend/tests/unit/request-validator.test.ts`
  - 의존: T007, T014
  - 완료 조건:
    - 경로를 정규화한다(`./`, 앞 `/` 제거)
    - 요청을 순서대로 검사해 거절 사유를 기록한다: `not_in_tree` → `not_a_file` → `excluded`/`too_large` → `already_read` → `over_round_limit` → `over_file_limit` → `budget`
    - `expandDirectories`는 최대 5개까지 받는다
    - `coverage`에 빠진 섹션은 `missing`으로 채우고 카탈로그 밖 `sectionId`는 버린다
    - `fileNotes.facts`의 라인 범위를 검증한다
  - 검증: `npm test -w backend -- request-validator` 통과. 거절 사유별 사례와 라인 범위 위반 사례를 포함한다.
  - 관련: FR-009, FR-011, Constitution I, II, contracts/llm-io.md §1 코드 후처리

- [X] T021 [US1] 조건부 추가 탐색 루프를 구현한다(초기 탐색 → Gemini 파일 선택 → 충분성 판단 → 추가 탐색 → 탐색 기록 저장): `backend/src/pipeline/explore-loop.ts`, `backend/src/pipeline/progress.ts`, `backend/tests/support/fake-github.ts`, `backend/tests/integration/explore-loop.test.ts`
  - 의존: T015, T018, T019, T020
  - 완료 조건:
    - research R1 루프를 구현한다
      - 시드를 읽는다
      - Decide #1에는 트리 목록, 수준·목적, 카탈로그, 남은 예산을 보낸다
      - 요청을 검증한 뒤 Round 1을 읽는다
      - Decide #2에는 새 원문과 누적 노트를 보낸다
      - `sufficient=false`이고 예산이 남았으면 Round 2·3을 읽는다
      - 마지막 라운드 뒤에는 Decide 없이 종료한다
    - 종료 사유를 기록한다: `sufficient`, `no_more_candidates`, `round_limit`, 예산 계열
    - Decide 호출마다 `exploration_rounds`에 요청, 수락·거절, 커버리지, 노트, `sufficient`, usage를 기록한다
    - 읽은 파일마다 `explored_files`에 `source`(`seed`/`llm_request`), `reason`, `round_no`를 기록한다
    - 단계와 진행 상황을 갱신한다: `selecting_files` → `reading_files` → `exploring_more`, `{round, maxRounds, filesRead, filesPlanned, activity, updatedAt}`
    - `progress.ts`에 하트비트 유틸을 둔다. 파일 읽기와 LLM 호출 동안 10초 이하 간격으로 `progress.updatedAt`과 `progress.activity`(`reading_files`, `llm_deciding`, `llm_writing`, `llm_retry_wait`, `validating_citations`)를 갱신한다(research R11)
  - 검증: `npm test -w backend -- explore-loop` 통과. Fake GitHub fixture와 Fake LLM 각본으로 다음을 확인한다.
    - (a) Decide #2에서 sufficient이면 1라운드로 끝난다
    - (b) 계속 insufficient이면 3라운드 후 `round_limit`
    - (c) 잘못된 요청이 사유와 함께 거절·기록된다
    - (d) 파일 한도·비용 한도로 중단된다
    - (e) **같은 저장소에서 목적별로 다른 요청을 하면 작업 집합이 달라진다**(정적 파이프라인이 아님을 검증)
    - (f) 인젝션 fixture에서 LLM이 100개 파일을 요청해도 한도로 잘린다
    - (g) 가짜 타이머와 응답이 느린 Fake LLM으로, LLM 호출 중에도 `progress.updatedAt` 갱신 간격이 10초 이하다(SC-002)
  - 관련: FR-007~FR-014, Constitution I, II, VI, VII, research R1, R2

### 매뉴얼 생성 (F) · 근거 연결 (E-MVP)

- [X] T022 [P] [US1] 근거 연결 검증과 매뉴얼 조립을 구현한다: `backend/src/pipeline/citation-validator.ts`, `backend/src/pipeline/manual-assembler.ts`, `backend/src/github/permalink.ts`, `backend/tests/unit/{citation-validator,manual-assembler}.test.ts`
  - 의존: T007, T019
  - 완료 조건:
    - research R8 규칙 1~6을 **그대로** 구현한다
      - 작업 집합 밖 경로의 근거를 제거한다
      - `1 ≤ startLine ≤ endLine ≤ line_count`를 위반한 근거를 제거하고, 범위를 보정하지 않는다
      - 근거가 0개인 `fact`는 `inference`로 바꾸고 `downgraded=true`로 둔다
      - 빠진 섹션을 `not_found`로 채운다
      - 퍼머링크(`/blob/{commitSha}/{path}#L{s}-L{e}`)를 붙인다
      - `stats`를 계산한다
    - 조립 규칙
      - 카탈로그 순서로 정렬하고 카탈로그 밖 섹션을 버린다
      - 섹션 제목은 카탈로그 상수로 덮어쓴다
      - `levelExtras`는 해당 수준 필드만 남긴다
      - 코드 한계 문구를 `limitations` 맨 앞에 둔다
      - 작업 집합에서 README 계열을 뺀 텍스트 파일이 0개이면 고정 한계 문구 "README 외에 분석할 수 있는 파일이 없어 README 내용만으로 작성했습니다"를 `limitations` 맨 앞에 넣고 상태는 completed를 유지한다(FR-008)
    - 결과는 shared `Manual` 스키마로 검증한다
  - 검증: `npm test -w backend -- citation-validator manual-assembler` 통과. contracts/manual.md 불변식 1~6을 각각 테스트한다.
  - 관련: FR-022, FR-024, FR-025, FR-026, Constitution V, contracts/manual.md

- [X] T023 [US1] 사용자 수준·목적을 반영한 Write 입력 구성과 매뉴얼 생성을 구현한다: `backend/src/pipeline/write-manual.ts`, `backend/tests/unit/write-manual.test.ts`
  - 의존: T018, T019, T022
  - 완료 조건:
    - 원문 우선순위: 시드 → covered 근거 파일 → 나중 라운드 → 그 외
    - 원문 총량은 `LIMIT_MAX_CONTENT_CHARS` 이하로 맞추고, 초과 파일은 노트만 전달한다
    - 원문 포함 여부는 `explored_files.content_included_in_write`에 기록한다
    - 사전 비용이 상한을 넘으면 다음 순서로 줄인다: 낮은 우선순위 원문 제거 → 출력 상한 축소 → 그래도 불가하면 `failed(limit_reached)`
    - Write를 호출하고, 스키마 실패가 반복되면 `manual_generation_failed`로 처리한다
    - 결과를 조립기(T022)에 넘기고, 원문을 줄였으면 `content_trimmed`로 표시한다
  - 검증: `npm test -w backend -- write-manual` 통과. 항목: 우선순위 정렬, 빡빡한 비용 상한에서의 축소 순서, `content_trimmed` 판정, 수준별로 다른 가이드가 프롬프트에 들어감.
  - 관련: FR-020, FR-021, FR-023, Constitution VI, contracts/llm-io.md §2

- [X] T024 [US1] 분석 오케스트레이터를 구현하고 워커에 연결한다: `backend/src/pipeline/run-analysis.ts`, `backend/src/index.ts`(핸들러 등록), `backend/tests/integration/run-analysis.test.ts`, `backend/scripts/dev-analyze.ts`
  - 의존: T017, T021, T023
  - 완료 조건:
    - 단계 전이: `validating_repo`(공개 확인, ref 해석, 커밋 고정) → `scanning_structure`(스냅샷 upsert·재사용, 필터, 시드) → 탐색 루프 → `writing_manual` → `done`
    - 상태 판정은 data-model.md 상태 전이 규칙을 **그대로** 따른다
      - 한도 계열 `stop_reason`이고 섹션이 partial이나 not_found → `partial`
      - `tree_truncated` → `repo_too_large`
      - 원문 축소 → `content_trimmed`
      - 정보가 없어 생긴 not_found만 있으면 → `completed`
    - 매뉴얼, usage, `stop_reason`을 저장하고 `reserved_cost_usd`를 0으로 되돌린다
    - Write 호출과 인용 검증 동안에도 T021의 하트비트로 `progress.activity`와 `updatedAt`을 갱신한다
  - 검증: `npm test -w backend -- run-analysis` 통과. 메모리 리포지토리와 fake로 다음을 확인한다.
    - 완료 경로
    - **README가 빈약한 fixture에서도 README 외 파일 근거가 포함됨**(FR-008)
    - README만 있는 저장소 fixture → "README 외 파일 없음" 고정 한계 문구가 포함되고 completed(FR-008)
    - `round_limit`과 not_found가 겹치면 partial
    - 한도 없이 not_found만 있으면 completed
    - `repo_not_found_or_private`, `repo_empty`, `no_analyzable_files`, `manual_generation_failed` 실패 경로
    - **🔗 연결 ④**: `npm run dev:analyze -- <공개 저장소 URL> --level beginner --purpose setup` → 실제 GitHub·Gemini로 처리되고, DB에 `analyses`, `exploration_rounds`, `explored_files`, `manuals`가 저장되며, 요약(라운드, 파일 수, 비용, 섹션 상태)이 출력된다
  - 관련: FR-006~FR-019, FR-028, Constitution I~VI, data-model.md 상태 전이

### API (매뉴얼 저장·조회)

- [X] T025 [US1] 분석 시작·상태·매뉴얼 조회 API와 사용자 안내 고정 문구를 구현한다: `backend/src/api/routes/analyses.ts`, `backend/src/api/client-key.ts`(IP 해시만), `backend/src/api/messages.ts`, `backend/tests/unit/{api-analyses,messages}.test.ts`
  - 의존: T011, T024
  - 완료 조건:
    - `messages.ts`: 모든 `failure_code`와 `partial_reason`을 한국어 `{message, action}`에 매핑한다. 문구는 contracts/http-api.md "사용자 메시지 매핑" 표를 따르고, LLM 생성 문구는 쓰지 않는다(Constitution II, 보안 제약, FR-028)
    - `POST /api/analyses`
      - shared 파서로 검증하고, 실패하면 `400 invalid_url`과 형식 예시를 반환한다
      - 같은 owner·name·ref·level·purpose의 진행 중 분석이 있으면 `deduplicated:true`로 기존 ID를 반환한다
      - 새 분석은 `queued`, 한도 스냅샷, `expires_at`, `client_key_hash = sha256(ip + CLIENT_KEY_SALT)`, `root_analysis_id = 자기 자신`으로 생성하고 `202`를 반환한다
    - `GET /api/analyses/{id}`: 요약, stage, progress(`activity`, `updatedAt` 포함), `queuePosition`(queued일 때만, 먼저 생성된 queued 분석 수 + 1), failure·partialReasons(`messages.ts`로 채움), hasManual, versions
    - `GET /api/analyses/{id}/manual`: 매뉴얼이 없으면 `409 not_ready`
    - 모든 응답은 shared zod 스키마로 직렬화를 검증한다
  - 검증: `npm test -w backend -- api-analyses messages`(inject와 메모리 리포지토리로 계약 형태, 400·404·409, 중복 요청, `queuePosition` 계산, **enum의 모든 값이 매핑되었는지 전수 검사**). **🔗 연결 ⑤**: `npm run dev` 후 `curl -X POST /api/analyses` → `GET /api/analyses/{id}`를 폴링하면 stage가 변하고 → `GET .../manual`이 매뉴얼 JSON을 반환한다
  - 관련: FR-001~FR-005, FR-018, FR-028, FR-031, SC-002, SC-007, contracts/http-api.md

### Frontend (G)

- [X] T026 [P] [US1] 프론트엔드 API 계층과 폴링 훅을 구현한다: `frontend/src/api/client.ts`, `frontend/src/api/queries.ts`, `frontend/src/lib/labels.ts`, `frontend/tests/queries.test.tsx`
  - 의존: T004, T007(백엔드 구현과 무관하게 shared 계약만 사용)
  - 완료 조건:
    - fetch 래퍼가 `ErrorResponse`를 파싱한다
    - 훅: `useCreateAnalysis`, `useAnalysis(id)`, `useManual(id)`
      - `useAnalysis`는 `queued`나 `running`이면 2초 간격으로 폴링하고 종료 상태에서 멈춘다
      - `useManual`은 `hasManual`일 때만 요청한다
    - 수준·목적·단계 한국어 라벨을 정의한다
  - 검증: `npm test -w frontend -- queries` 통과. mock fetch로 종료 상태에서 폴링이 멈추는지, 오류가 파싱되는지 확인한다.
  - 관련: FR-018, SC-002, research R11

- [X] T027 [US1] 홈 화면(저장소 URL 입력, 사용자 수준 선택, 매뉴얼 목적 선택)을 구현한다: `frontend/src/pages/HomePage.tsx`, `frontend/src/components/{RepoForm,LevelPicker,PurposePicker}.tsx`, `frontend/tests/RepoForm.test.tsx`
  - 의존: T008, T026
  - 완료 조건:
    - shared 파서로 즉시 검증하고 형식 예시를 표시한다(FR-002)
    - 수준 카드 3개에 한 줄 설명을 붙인다(FR-003)
    - 목적 카드 3개는 하나만 선택할 수 있다(FR-004)
    - 세 값이 모두 정해져야 시작 버튼이 활성화된다(FR-005)
    - 제출하면 `/a/{id}`로 이동한다
    - 모바일 폭에서 레이아웃이 깨지지 않는다
  - 검증: `npm test -w frontend -- RepoForm` 통과. 항목: 잘못된 URL 메시지, 버튼 활성 조건, 제출 시 이동.
  - 관련: FR-001~FR-005, US1 #1

- [X] T028 [US1] 분석 화면(진행 상태, 매뉴얼 결과, 원본 GitHub 근거 링크)을 구현한다: `frontend/src/pages/AnalysisPage.tsx`, `frontend/src/components/{ProgressStepper,ManualView,SectionView,BlockView,LevelExtrasView,FactBadge,EvidenceChip,NotFoundNotice,SafeMarkdown,PartialBanner,FailureNotice}.tsx`, `frontend/tests/{ManualView,ProgressStepper,PartialBanner,FailureNotice}.test.tsx`
  - 의존: T026
  - 완료 조건:
    - 진행 표시: 7단계 스텝퍼, 추가 탐색 `n/최대`, 읽은 파일 수, 현재 활동(`progress.activity`)과 경과 시간, queued면 대기 순서(`queuePosition`)와 대기 경과 시간(1초 간격 클라이언트 계산)
    - 매뉴얼 본문
      - 카탈로그 순서로 섹션을 표시한다
      - 블록 유형별로 표시한다: `text`, `step`(명령 코드 블록, 정상 결과, 실패 시 대처)
      - `FactBadge`: 확인됨/추론, 강등된 블록에는 툴팁
      - `EvidenceChip`: `path:Ls-Le` 형식, 새 탭으로 열고 `rel="noopener noreferrer"`
      - `not_found` 섹션은 "저장소에서 확인되지 않음"으로 표시한다
      - 수준별 추가 요소(`LevelExtrasView`)를 표시한다
    - `SafeMarkdown`은 원시 HTML을 렌더링하지 않고 `http(s)` 링크만 허용한다
    - `PartialBanner`: 부분 완료면 사유(`partialReasons`)와 `limitations`를 매뉴얼 위에 항상 표시한다(Constitution II)
    - `FailureNotice`: 실패면 고정 문구 메시지와 조치를 표시한다(보안 제약)
    - 375px 폭에서 가로 스크롤이 없고, 근거 칩과 코드 블록이 줄바꿈되거나 내부 스크롤된다
  - 검증: `npm test -w frontend -- ManualView ProgressStepper PartialBanner FailureNotice` 통과. 항목: 배지, 근거 링크 href(커밋 SHA 포함), not_found 안내, `<script>` 마크다운 미렌더링, 단계·활동·경과 시간 표시, queued fixture에서 대기 순서와 경과 시간 표시, partial fixture에서 배너 표시, failed fixture에서 안내 표시. **🔗 연결 ⑥**: `npm run dev` 후 브라우저 전체 흐름(T029)
  - 관련: FR-018, FR-020~FR-026, FR-028, Constitution II, research R9, R11, contracts/manual.md 화면 표시 규칙

### US1 통합 검증 (H)

- [X] T029 [US1] Frontend/Backend 통합과 US1 시나리오를 검증하고 기록한다: `specs/001-repo-manual-generator/verification-log.md`
  - 의존: T025, T027, T028
  - 완료 조건: `npm run dev`로 quickstart V1, V3, V4를 실제 저장소로 수행하고, 결과(저장소, 소요 시간, 비용, 상태, 관찰 내용)를 기록한다
  - 검증:
    - V1: 5초 안에 첫 진행 상태가 나오고 30초 이상 무갱신 구간이 없다. `progress.updatedAt` 간격 측정값을 기록한다. 완료 후 setup 6개 섹션과 입문자 단계 블록이 표시된다.
    - V3·V4: 수준별 구성 차이가 있다
    - 기록 파일에 결과가 남는다
  - 관련: US1 Acceptance #1~#6, SC-001, SC-002

**Checkpoint**: US1이 단독으로 동작한다. 부분 완료·실패 결과도 원인과 함께 표시된다(Constitution II, 보안 제약). 로컬 MVP 시연이 가능하다. 연결 ①~⑥이 모두 확인되었다.

---

## Phase 4: User Story 2 - 매뉴얼 근거 확인 (Priority: P2)

**Goal**: 사용자가 근거 파일·라인으로 이동해 검증하고, 분석에 쓰인 파일과 선택 이유, 탐색 판단 기록을 볼 수 있다.

**Independent Test**: 완료된 매뉴얼에서 확인됨 블록의 근거 링크가 분석 커밋의 실제 라인을 연다. "분석 내역" 탭에서 파일 목록, 선택 이유, 라운드별 요청·거절, 커밋, 한도 도달 여부를 볼 수 있다(quickstart V2, V5, V6).

- [ ] T030 [US2] 분석 내역 API를 구현한다: `backend/src/api/routes/analyses.ts`(`GET /api/analyses/{id}/trace`), `backend/tests/unit/api-trace.test.ts`
  - 의존: T025
  - 완료 조건:
    - contracts/http-api.md `/trace` 응답 형태 그대로 반환한다: `repo`, `detectedStack`, `treeStats`, `limits`, `usage`, `stopReason`, `limitReached`, `decisions[]`(요청별 accepted·rejectReason), `files[]`(source, reason, roundNo, truncated, contentIncludedInWrite, 커밋 고정 `githubUrl`)
    - 실행 중에도 지금까지의 기록을 반환한다
  - 검증: `npm test -w backend -- api-trace` 통과. 항목: 계약 스키마 검증, 진행 중 부분 기록, 404.
  - 관련: FR-011, FR-027, Constitution I, II

- [ ] T031 [P] [US2] 분석 내역 화면을 구현한다: `frontend/src/components/TracePanel.tsx`, `frontend/src/pages/AnalysisPage.tsx`("매뉴얼 / 분석 내역" 탭), `frontend/src/api/queries.ts`(`useTrace`), `frontend/tests/TracePanel.test.tsx`
  - 의존: T026, T028(백엔드 T030과 병렬 가능, 계약 기준)
  - 완료 조건:
    - 파일 목록: 경로 링크, 라운드, 출처 라벨(시드/AI 요청/재사용), 선택 이유, 잘림·원문 포함 여부
    - 라운드별 판단: sufficient, 커버리지, 수락·거절된 요청(거절 사유 한국어 라벨)
    - 분석 커밋 SHA, 적용 한도와 사용량, 한도 도달 표시
    - 375px 폭에서 가로 스크롤이 없고, 긴 경로는 줄바꿈된다
  - 검증: `npm test -w frontend -- TracePanel` 통과. fixture 응답으로 거절 사유 라벨과 링크를 확인한다.
  - 관련: FR-027, US2 #3

- [ ] T032 [US2] 근거 연결 검증을 끝단까지 확인한다: `backend/tests/integration/citations-e2e.test.ts`, `specs/001-repo-manual-generator/verification-log.md`
  - 의존: T024, T030, T031
  - 완료 조건:
    - 파이프라인 통합 테스트를 작성한다. Fake LLM이 다음 근거를 섞어 반환한다.
      - 존재하지 않는 경로
      - 범위를 넘은 라인
      - 근거 없는 fact
    - 저장된 매뉴얼에서 확인할 것
      - 모든 fact에 유효한 근거가 있다
      - 강등이 기록된다
      - 퍼머링크가 분석 커밋 SHA를 쓴다
      - `/trace`의 files와 근거 경로가 일치한다
    - quickstart V2, V5, V6을 수동으로 수행하고 기록한다
  - 검증: `npm test -w backend -- citations-e2e` 통과. 기록 파일에 V2, V5, V6 결과가 남는다.
  - 관련: FR-022, FR-024~FR-027, SC-003, Constitution V

**Checkpoint**: US1과 US2가 함께 동작한다. 근거와 탐색 과정을 사용자가 검증할 수 있다.

---

## Phase 5: User Story 3 - 분석 실패·부분 완료 원인 안내 (Priority: P2)

**Goal**: US1의 기본 실패·부분 완료 안내 위에 엣지 케이스 처리, 재시도 안내, 실패 응답 안전성, 사용량 보호(공개 전 필수)를 더한다.

**Independent Test**: 다음 입력에서 각각 올바른 상태와 안내가 표시되는지 확인한다(quickstart V7, V8, V9, V14, V15, V16, V17).
- 잘못된 URL, 존재하지 않는 저장소, 비공개 저장소, 빈 저장소, 큰 저장소
- 한도 축소 설정, 요청 제한 도달

- [ ] T033 [US3] 실패 응답 안전성과 재시도 안내를 보강한다: `backend/src/api/routes/analyses.ts`, `backend/src/api/messages.ts`, `backend/tests/unit/api-failure-safety.test.ts`
  - 의존: T025
  - 완료 조건:
    - `GET /api/analyses/{id}`의 `failure.retryAfterSec`를 `analyses.failure_retry_at`(T034가 저장)에서 계산한다. rate-limit 계열이 아니면 null이다.
    - 내부 오류 상세(예외 메시지, 스택, 외부 API 원문 응답)는 서버 로그에만 남기고 응답에는 포함하지 않는다(FR-029)
    - T034가 다루는 엣지 케이스 코드(`repo_too_large`, `timeout` 등)의 문구가 상황에 맞는지 검토하고 필요하면 보완한다
  - 검증: `npm test -w backend -- api-failure-safety` 통과. 항목: 내부 예외 메시지를 주입한 실패 분석의 응답에 그 문자열이 없음, `github_rate_limited` 실패의 `retryAfterSec` 계산, 그 외 코드는 null.
  - 관련: FR-028, FR-029, SC-007, US3

- [ ] T034 [US3] 엣지 케이스 처리를 파이프라인에 보강한다: `backend/src/pipeline/run-analysis.ts`, `backend/tests/integration/run-analysis-edge.test.ts`, `backend/tests/fixtures/github/`(엣지 fixture)
  - 의존: T024
  - 완료 조건:
    - 잘린 트리 → `partial(repo_too_large)`, 분석한 범위를 `limitations`에 표시
    - `subpath` 우선 탐색
    - 분석 도중 저장소 삭제·비공개 전환 → `failed(repo_not_found_or_private)`
    - 시간 상한 도달 → 확보한 정보로 Write가 가능하면 partial, 불가하면 `failed(timeout)`
    - 실행 중 GitHub 한도 → `failed(github_rate_limited)`, 재시도 가능 시각을 `failure_retry_at`에 저장한다(Gemini 한도 `llm_rate_limited`도 같은 방식)
    - Gemini 장애 → `failed(llm_unavailable)`
    - 문서 전용 저장소 → 해당 없는 섹션 not_found
    - 심볼릭 링크 README(모노레포, 예: vercel/next.js의 루트 `readme.md`)는 링크 대상 파일을 시드로 읽는다. T015 실측에서 symlink 제외 규칙 때문에 루트 README가 시드에서 빠지는 것을 확인했다.
    - 분석 도중 새 커밋이 생겨도 고정 SHA를 유지
  - 검증: `npm test -w backend -- run-analysis-edge` 통과. 엣지 케이스마다 fixture를 하나씩 둔다.
  - 관련: spec Edge Cases, FR-013, FR-017, FR-028

- [ ] T035 [US3] 사용량 보호를 구현한다(접속 출처 요청 제한, 서비스 일일 비용 상한 예약): `backend/src/api/client-key.ts`, `backend/src/api/routes/analyses.ts`, `backend/src/pipeline/run-analysis.ts`(예약 해제), `backend/tests/unit/client-key.test.ts`, `backend/tests/db/limits.test.ts`
  - 의존: T025, T024
  - 완료 조건:
    - `TRUST_PROXY`가 켜지면 `X-Forwarded-For`를 쓴다
    - 최근 24시간 같은 키의 생성 수가 `LIMIT_REQUESTS_PER_CLIENT_PER_DAY` 이상이면 `429 rate_limited`를 반환한다. `retryAfterSec`는 가장 오래된 요청 + 24시간 − 현재다.
    - `오늘(Asia/Seoul 자정 기준) 실제 지출 + 진행 중 예약 + 신규 예약(실행 상한) > LIMIT_DAILY_COST_USD`이면 `503 daily_budget_exhausted`를 반환하고, 다음 KST 자정까지 남은 초를 알려준다
    - 중복 요청(`deduplicated`)은 집계에서 뺀다
    - 종료 시 예약을 해제한다
  - 검증: `npm test -w backend -- client-key`(고정 시계로 시간 계산, 경계값), `npm run test:db -- limits`(집계 쿼리, 동시 요청 시 일일 상한 초과 방지)
  - 관련: FR-034, FR-035, Constitution VI, research R5, R16

- [ ] T036 [P] [US3] 요청 거절 표시와 재시도 안내 화면을 보강한다: `frontend/src/components/RepoForm.tsx`(400·429·503 표시), `frontend/src/components/FailureNotice.tsx`(재시도 시각), `frontend/tests/{RepoFormErrors,FailureNotice}.test.tsx`
  - 의존: T028(기본 `FailureNotice`·`PartialBanner`는 T028에 있음. 백엔드 T033·T035와 병렬 가능, 계약 기준)
  - 완료 조건:
    - `FailureNotice`에 재시도 가능 시각(`retryAfterSec`를 KST 시각으로 변환)을 추가한다
    - 홈 폼에서 `400 invalid_url`·`429 rate_limited`·`503 daily_budget_exhausted` 응답의 메시지, 조치, 재시도 시각을 보여준다
  - 검증: `npm test -w frontend -- RepoFormErrors FailureNotice` 통과. 항목: 코드별 메시지 표시, `retryAfterSec` → KST 시각 변환.
  - 관련: FR-028, FR-034, FR-035, US3 #1~#5

- [ ] T037 [US3] US3 시나리오를 검증한다: `specs/001-repo-manual-generator/verification-log.md`
  - 의존: T033, T034, T035, T036
  - 완료 조건: quickstart V7, V8, V9, V14, V15, V16, V17을 수행하고 기록한다. V9, V15, V17은 `.env` 한도를 낮춰서, V14는 인젝션 문구가 든 테스트 저장소로 수행한다.
  - 검증: 시나리오별로 기대 결과가 일치하고, V9의 분석 내역에 `over_file_limit` 거절이 기록되어 있다
  - 관련: US3 Acceptance, FR-015, FR-034, FR-035

**Checkpoint**: 실패와 부분 완료가 모두 설명 가능하다. 비용 보호가 동작한다. 외부 공개를 위한 최소 조건을 갖췄다.

---

## Phase 6: User Story 4 - 기존 분석 및 매뉴얼 재조회 (Priority: P3)

**Goal**: 로그인 없이 고유 링크와 브라우저 최근 목록으로 결과를 다시 보고, 보관 기간이 지난 결과를 안내한다.

**Independent Test**: 완료 후 탭을 닫고 홈의 최근 목록이나 링크로 다시 접근하면 재분석 없이 3초 안에 같은 결과가 표시된다. 시크릿 창에서도 같은 링크로 결과가 보인다(quickstart V10, V11).

- [ ] T038 [US4] 최근 목록 일괄 조회 API를 구현한다: `backend/src/api/routes/analyses.ts`(`GET /api/analyses?ids=`), `backend/tests/unit/api-batch.test.ts`
  - 의존: T025
  - 완료 조건: 쉼표로 구분한 UUID를 최대 20개 받는다. 형식 오류는 400이다. 응답은 `{items, missingIds}`이며, 삭제·만료·없는 ID는 `missingIds`에 넣는다.
  - 검증: `npm test -w backend -- api-batch` 통과
  - 관련: FR-030, US4 #2, research R14

- [ ] T039 [P] [US4] 브라우저 최근 분석 목록을 구현한다: `frontend/src/lib/recent-store.ts`, `frontend/src/components/RecentList.tsx`, `frontend/src/pages/HomePage.tsx`, `frontend/tests/{recent-store,RecentList}.test.tsx`
  - 의존: T027(백엔드 T038과 병렬 가능, 계약 기준)
  - 완료 조건:
    - 분석을 생성하거나 열 때 localStorage에 항목을 추가한다(id, 저장소, 수준, 목적, 생성 시각)
    - 최대 20개, 중복은 제거하고 최신순으로 둔다
    - 모든 접근을 try/catch로 감싼다
    - 목록은 일괄 조회로 상태를 갱신하고, `missingIds`는 "만료됨"으로 표시한다
  - 검증: `npm test -w frontend -- recent-store RecentList` 통과. **저장소 접근이 예외를 던져도 화면이 동작**해야 한다.
  - 관련: FR-030, US4 #2, Edge Cases(브라우저 기록 삭제)

- [ ] T040 [US4] 보관 기간 만료 처리와 만료 화면을 구현한다: `backend/src/jobs/cleanup.ts`, `backend/src/index.ts`(1시간 주기 등록), `backend/src/api/routes/analyses.ts`(410), `frontend/src/pages/AnalysisPage.tsx`(만료 상태와 "다시 분석"), `backend/tests/db/cleanup.test.ts`, `backend/tests/unit/api-expired.test.ts`
  - 의존: T025, T017
  - 완료 조건:
    - `expires_at`이 지난 분석은 `status=expired`로 바꾸고, 매뉴얼·라운드·작업 집합을 삭제한 뒤 행은 남긴다
    - 참조가 없는 스냅샷과 파일 원문을 삭제한다
    - 만료된 ID는 모든 조회 엔드포인트에서 `410 expired`를 반환한다
    - 화면은 만료 안내와 함께, 같은 URL·수준·목적이 미리 채워진 홈으로 이동하는 버튼을 보여준다
  - 검증: `npm run test:db -- cleanup`(만료 전이, 고아 스냅샷 삭제, 유효한 데이터 보존), `npm test -w backend -- api-expired`
  - 관련: research R17, Edge Cases(만료된 링크), spec Assumptions(30일 보관)

- [ ] T041 [US4] US4 시나리오를 검증한다: `specs/001-repo-manual-generator/verification-log.md`
  - 의존: T038, T039, T040
  - 완료 조건: quickstart V10, V11을 수행하고 기록한다. 재조회 시 파이프라인 호출이 없는지 서버 로그와 usage가 바뀌지 않았는지로 확인한다.
  - 검증: 재조회가 3초 이내이고(SC-009), 시크릿 창에서도 링크로 결과가 보이며, 진행 중 이탈 후 재접속하면 상태가 이어진다
  - 관련: US4 Acceptance, FR-019, FR-031, SC-009

**Checkpoint**: 링크 공유와 재조회가 가능하다. 만료 정책이 동작한다.

---

## Phase 7: User Story 5 - 매뉴얼 재생성 (Priority: P3)

**Goal**: 수준·목적을 바꿔 기존 분석 결과를 재사용해 다시 만들거나, 새 커밋 기준으로 재분석한다. 이전 버전은 보존한다.

**Independent Test**: 완료된 결과에서 수준을 바꿔 재생성하면 GitHub 재조회 없이 새 버전이 만들어지고, 버전 선택기로 이전 매뉴얼도 볼 수 있다. 새 커밋이 생긴 저장소에서는 "최신 커밋으로 다시 분석"이 동작한다(quickstart V12, V13).

- [ ] T042 [US5] 최신 커밋 확인 API를 구현한다: `backend/src/api/routes/analyses.ts`(`GET /api/analyses/{id}/freshness`), `backend/src/github/freshness-cache.ts`, `backend/tests/unit/api-freshness.test.ts`
  - 의존: T025, T013
  - 완료 조건:
    - 응답은 `{analyzedCommitSha, latestCommitSha, isOutdated, checkedAt}`이다
    - 결과는 `(owner, name, ref)` 기준으로 5분간 메모리에 캐시한다
    - 커밋이 아직 고정되지 않았으면 `409 not_ready`를 반환한다
  - 검증: `npm test -w backend -- api-freshness` 통과. 캐시 적중 시 GitHub를 호출하지 않는다.
  - 관련: US4 #4, US5 #2, contracts/http-api.md

- [ ] T043 [US5] 재생성 API와 버전 계보를 구현한다: `backend/src/api/routes/analyses.ts`(`POST /api/analyses/{id}/regenerations`, `versions`), `backend/tests/unit/api-regenerations.test.ts`
  - 의존: T042, T035
  - 완료 조건:
    - 부모가 `completed` 또는 `partial`이 아니면 `409 parent_not_finished`
    - `change_options`는 **level 또는 purpose 중 하나 이상이 부모와 달라야 한다**. 같으면 `400 invalid_request`. 부모와 같은 `snapshot_id`를 쓴다.
    - `refresh_commit`은 `isOutdated=true`일 때만 허용하고, 아니면 `409 already_latest`
    - 새 분석에는 `parent_analysis_id`, `root_analysis_id = 부모의 root`, `regeneration_mode`를 저장한다
    - 요청 제한과 일일 예산 검사를 똑같이 적용한다
    - `GET /{id}`의 `versions`는 같은 root의 분석을 생성순으로 반환한다
  - 검증: `npm test -w backend -- api-regenerations` 통과. 모든 409·400 분기와 계보를 확인한다.
  - 관련: FR-032, FR-033, data-model.md `analyses` 검증 규칙

- [ ] T044 [US5] 분석 결과 재사용(`change_options`)과 재분석(`refresh_commit`)을 파이프라인에 구현한다: `backend/src/pipeline/run-analysis.ts`, `backend/src/pipeline/explore-loop.ts`, `backend/tests/integration/regeneration.test.ts`
  - 의존: T024, T043
  - 완료 조건:
    - `change_options`
      - `validating_repo`와 `scanning_structure`를 건너뛰고 스냅샷을 재사용한다
      - 부모의 작업 집합을 `source=reused`, `round_no=0`으로 등록하고 원문은 `snapshot_files`에서 읽는다(GitHub 호출 0)
      - 부모의 `file_notes`를 Decide #1 입력에 넣는다
      - `LIMIT_MAX_FILES`는 재사용 파일과 새 파일을 합친 작업 집합에 적용한다
      - 새 수준·목적에 필요한 파일만 추가로 탐색한다
    - `refresh_commit`: 최신 커밋으로 새 스냅샷을 만들어 처음부터 분석한다
    - 부모 분석과 매뉴얼은 바뀌지 않는다
  - 검증: `npm test -w backend -- regeneration` 통과. 항목: 재사용 파일 GitHub 호출 0, reused 기록, 부모 불변, 목적 변경 시 추가 요청 발생, refresh 시 새 SHA.
  - 관련: FR-032, FR-033, Constitution VI, research R15

- [ ] T045 [P] [US5] 재생성 화면을 구현한다: `frontend/src/components/{RegeneratePanel,FreshnessBanner,VersionSwitcher}.tsx`, `frontend/src/api/queries.ts`(`useFreshness`, `useRegenerate`), `frontend/src/pages/AnalysisPage.tsx`, `frontend/tests/{RegeneratePanel,FreshnessBanner,VersionSwitcher}.test.tsx`
  - 의존: T028(백엔드 T042~T044와 병렬 가능, 계약 기준)
  - 완료 조건:
    - `RegeneratePanel`: 수준·목적을 바꿀 수 있고, 둘 다 같으면 비활성화한다
    - `FreshnessBanner`: 새 커밋이 있으면 "최신 커밋으로 다시 분석" 버튼을 보여준다
    - `VersionSwitcher`: 버전 목록(수준, 목적, 커밋, 상태, 시각)을 보여주고 선택하면 이동한다
    - 재생성 요청 오류(409·429·503)는 `FailureNotice` 형식으로 표시한다
    - 새 분석 ID를 최근 목록에 추가한다
    - 375px 폭에서 가로 스크롤 없이 패널과 버전 목록이 표시된다
  - 검증: `npm test -w frontend -- RegeneratePanel FreshnessBanner VersionSwitcher` 통과
  - 관련: FR-032, FR-033, US5 #1~#4

- [ ] T046 [US5] US5 시나리오를 검증한다: `specs/001-repo-manual-generator/verification-log.md`
  - 의존: T044, T045
  - 완료 조건: quickstart V12, V13을 수행하고 기록한다. V13은 직접 소유한 공개 테스트 저장소에 커밋을 추가해서 수행한다.
  - 검증: 재생성 버전과 이전 버전을 모두 볼 수 있다. V12에서 재사용 파일과 GitHub 호출 감소가 분석 내역에 나타난다.
  - 관련: US5 Acceptance

**Checkpoint**: US1~US5가 모두 동작한다.

---

## Phase 8: Integration & Verification (H) · Cross-Cutting

**Purpose**: 실제 저장소 분석 검증, 조건별 차이 검증, 보안·배포 전 점검, quickstart 전체 검증

- [ ] T047 실제 API 평가 스크립트를 구현한다: `backend/scripts/eval.ts`, `backend/scripts/eval-repos.json`, 루트 `eval` 스크립트
  - 의존: T024, T030
  - 완료 조건:
    - `eval-repos.json`에 저장소 5~10개를 둔다. 각 항목에 사람이 지정한 `keyFiles`를 둔다.
      - README가 빈약한 공개 저장소 2개 이상
      - Node, Python, Go 등 서로 다른 스택
      - 파일 1,000개를 넘는 모노레포 1개
      - 문서 전용 저장소 1개
    - 지정한 수준·목적 조합으로 실제 분석을 실행한다
    - 출력 지표
      - 상태, 소요 시간, 비용, 라운드 수
      - README 외 근거 포함 여부(SC-004)
      - 근거 유효율과 강등 수(SC-003)
      - 한도 준수(SC-008), 부분 완료율
      - **목적별 작업 집합 차이**: 목적 쌍별 Jaccard 유사도와 저장소별 평균(FR-009)
      - **확장 게이트 지표**: 대형 저장소의 `keyFiles` 누락률, `round_limit` 부분 완료 비율(research R13)
    - 결과를 `specs/001-repo-manual-generator/eval/report-YYYY-MM-DD.md`로 저장한다
  - 검증: `npm run eval -- --repos 1`로 저장소 1개를 끝까지 실행하고 리포트 파일이 생성된다
  - 관련: SC-001, SC-003, SC-004, SC-008, research R13, R21

- [ ] T048 실제 저장소 분석과 빈약한 README 저장소를 검증한다: `specs/001-repo-manual-generator/eval/report-YYYY-MM-DD.md`, `specs/001-repo-manual-generator/verification-log.md`
  - 의존: T047, T037
  - 완료 조건: 전체 평가 목록으로 `npm run eval`을 실행한다. README가 빈약한 저장소의 매뉴얼이 설정, 소스, 매니페스트 근거로 필수 섹션을 채우는지 사람이 확인하고 기록한다. 기준 미달 항목은 원인(프롬프트, 한도, 필터)을 분석해 후속 작업으로 기록한다.
  - 검증:
    - README 외 근거 포함 100%(SC-004)
    - 근거 유효율 100%(SC-003)
    - 한도 초과 0건(SC-008)
    - 파일 1,000개 이하 저장소의 90%가 5분 이내(SC-001)
    - 후보 파일이 100개 이상인 저장소에서 목적 간 평균 Jaccard 0.8 이하, 작업 집합이 완전히 같은 목적 쌍 0건(FR-009). 작은 저장소는 어느 목적이든 대부분의 파일을 읽으므로 이 기준에서 제외한다.
  - 관련: FR-008, FR-009, SC-001, SC-003, SC-004, SC-008

- [ ] T049 조건별 매뉴얼 차이를 검증한다(수준·목적): `specs/001-repo-manual-generator/eval/blind-kit/`, `specs/001-repo-manual-generator/verification-log.md`
  - 의존: T047
  - 완료 조건:
    - 저장소 3개 × 수준 3개로 매뉴얼 9개를 만들어 수준 표시를 지운 블라인드 키트(매뉴얼, 정답표, 평가 양식)를 준비한다
    - 같은 저장소의 목적 3개 매뉴얼에서 섹션 구성과 작업 집합 차이를 확인한다
    - 입문자 실행 테스트(SC-006) 진행 절차서를 작성한다
  - 검증: 평가자 2명 이상의 블라인드 판별 정답률 80% 이상(SC-005). 미달이면 R24의 "상위 Write 모델" 조건으로 기록한다. SC-006은 참가자 테스트 결과로 기록한다.
  - 관련: FR-020, FR-021, SC-005, SC-006

- [ ] T050 보안을 점검하고 강화한다: `backend/tests/unit/security.test.ts`, `specs/001-repo-manual-generator/verification-log.md`
  - 의존: T037
  - 완료 조건:
    - 프론트 빌드 산출물(`frontend/dist`)에 비밀값 패턴(`AIza`, `github_pat_`, `postgresql://`)이 없음을 검사한다
    - pino redact 테스트(헤더와 키 미출력)
    - 오류 응답에 스택이나 내부 메시지가 없음을 검사한다
    - `npm audit`에서 high 이상 0건
    - `.env`가 git에 추적되지 않음
    - 마크다운 XSS 회귀 테스트
  - 검증: `npm test -w backend -- security` 통과, `npm audit --audit-level=high` 통과, 점검 결과를 기록한다
  - 관련: Constitution 보안 제약, FR-015, FR-029, research R9, R12

- [ ] T051 프로덕션 단일 서비스 실행과 배포 전 점검을 수행한다: 루트 `package.json`(`build`, `start`), `specs/001-repo-manual-generator/verification-log.md`
  - 의존: T050
  - 완료 조건:
    - `npm run build`가 shared → frontend → backend 순서로 빌드한다
    - `npm start`로 Node 하나가 API, 워커, 정적 SPA를 서빙한다. `/a/{id}` 직접 접근에 SPA fallback이 동작한다.
    - quickstart 6장 공개 전 점검표를 확인한다
      - Gemini Tier 1
      - GitHub 토큰 만료일 기록
      - 예산 알림
      - `TRUST_PROXY`
      - IPv4 호스트용 Session pooler 문자열
      - 한도 값
    - 실제 배포 여부와 호스팅 선택은 사용자가 결정한다
  - 검증: `npm run build && npm start` 후 `http://localhost:8787`에서 V1 흐름을 재현하고 `/api/health`가 정상이다. 점검표 결과를 기록한다.
  - 관련: research R22, quickstart 6장

- [ ] T052 quickstart 전체를 검증하고 문서를 정합시킨다: `specs/001-repo-manual-generator/quickstart.md`, 루트 `README.md`, `specs/001-repo-manual-generator/verification-log.md`
  - 의존: T046, T048, T049, T051
  - 완료 조건:
    - 새 클론 기준으로 quickstart 1~5장을 처음부터 따라 한다(설치, 마이그레이션, `npm test`, `npm run test:db`, V1~V17)
    - 문서와 실제가 다른 부분을 고친다
    - 루트 `README.md`에 실행 요약과 quickstart 링크를 둔다
    - 375px 폭에서 홈, 진행, 매뉴얼, 분석 내역, 재생성 화면을 확인하고 기록한다(spec Assumptions의 모바일 조건)
    - 남은 TODO, 플레이스홀더, `skip`·`only` 테스트를 검사한다
  - 검증: V1~V17 모두 통과로 기록한다. `npm test`, `npm run test:db`, `npm run lint`, `npm run typecheck`가 모두 통과한다. `skip`·`only`·`TODO` 검색 결과가 0건이다.
  - 관련: quickstart.md 전체, SC-001~SC-009

**Checkpoint**: MVP와 P2·P3 기능이 검증되었다. 확장 게이트 판정에 쓸 평가 리포트가 준비되었다.

---

## Phase 9: 조건부 확장 — Knowledge & Retrieval (E)

**Purpose**: 코드 청크, 임베딩, pgvector 검색, 지식 엔티티·관계 추출, Wiki 구조화. 사용자 결정에 따라 **조건부 Phase**로 둔다.

**⛔ 진입 게이트 (Constitution VII)**: T053에서 아래 조건 중 하나 이상이 **측정으로 확인될 때만** T054 이후를 진행한다. 조건이 충족되지 않으면 이 Phase는 실행하지 않는다. 판정 기록 자체가 완료 산출물이다.

- **검색 계열(T055~T057)**: [research.md](./research.md) R13 "도입 조건"
- **지식 계열(T058~T059)**: [research.md](./research.md) R24 "지식 엔티티·관계 추출", "Wiki 구조화" 행의 도입 조건

조건 원문은 research.md에만 둔다. 같은 기준이 두 곳에 있으면 서로 어긋날 수 있기 때문이다.

- [ ] T053 확장 게이트를 판정하고 기록한다: `specs/001-repo-manual-generator/eval/expansion-gate.md`
  - 의존: T048, T049
  - 완료 조건: 평가 리포트 지표를 검색 계열과 지식 계열 조건에 각각 대입해 충족 여부, 근거 수치, 결정(진행·보류)을 기록한다
  - 검증: 문서에 조건별 수치와 결정이 있다. 둘 다 미충족이면 이 Phase는 여기서 종료한다.
  - 관련: Constitution VII, research R13, R24

- [ ] T054 설계 문서를 개정한다(게이트 통과 계열만): `specs/001-repo-manual-generator/{plan.md,research.md,data-model.md}`, `specs/001-repo-manual-generator/contracts/{llm-io.md,http-api.md}`
  - 의존: T053(진행 결정)
  - 완료 조건:
    - `plan.md` Complexity Tracking에 측정 근거와 기각된 단순 대안을 기록한다
    - `research.md` R13·R24의 해당 항목을 결정으로 전환한다
    - `data-model.md`에 테이블을 추가한다: `file_chunks`, `knowledge_entities`, `knowledge_relations`, `wiki_pages`
    - 계약을 확장한다
      - 엔티티·관계는 Decide 출력 확장으로 받아 **새 LLM 호출 지점을 만들지 않는다**. 새 호출이 꼭 필요하면 Constitution IV 사유를 기록한다.
      - `GET /api/analyses/{id}/wiki`를 추가한다
    - 검색 계열을 진행하면 임베딩 호출(`gemini-embedding-2`)을 새 AI 모델 호출 지점으로 보고, Constitution IV 사유(결정적 코드로 대체할 수 없는 이유)를 plan에 기록한다. plan.md의 "LLM 호출 지점 2개" 서술과 contracts/llm-io.md의 호출 지점 목록도 갱신한다.
    - 기능 플래그 `KNOWLEDGE_RETRIEVAL_ENABLED`와 `KNOWLEDGE_WIKI_ENABLED`를 정의하고 기본값은 `false`로 둔다
  - 검증: 개정된 plan의 Constitution Check 게이트 G1~G5를 다시 평가해 통과로 기록한다
  - 관련: Constitution IV, VII, Governance

- [ ] T055 [P] 코드 청크 생성을 구현한다: `backend/src/knowledge/chunker.ts`, `backend/tests/unit/chunker.test.ts`
  - 의존: T054
  - 완료 조건:
    - 결정적 분할: 코드는 최상위 선언, 문서는 제목 기준으로 나누고, 최대 문자 수와 겹침을 설정값으로 둔다
    - 청크마다 `{path, startLine, endLine, contentHash}`를 만든다
    - 라인 범위는 `snapshot_files.line_count` 안에 있어야 한다
  - 검증: `npm test -w backend -- chunker` 통과. 언어별 fixture, 라인 범위 경계, 같은 입력이면 같은 출력.
  - 관련: research R13 후보 설계

- [ ] T056 임베딩 생성과 저장을 구현한다(pgvector): `backend/src/knowledge/embedder.ts`, `backend/src/llm/client.ts`(임베딩 메서드), `backend/src/db/schema.ts`(`file_chunks`), `backend/drizzle/*.sql`(HNSW 인덱스), `backend/tests/unit/embedder.test.ts`, `backend/tests/db/file-chunks.test.ts`
  - 의존: T055
  - 완료 조건:
    - `gemini-embedding-2`(텍스트 1M 토큰당 $0.20)로 배치 임베딩한다. 출력 차원은 구현 시 문서로 확인한다.
    - `file_chunks`(`snapshot_id`, `path`, `start_line`, `end_line`, `content_hash`, `embedding extensions.vector(N)`)에 저장하고 `(snapshot_id, content_hash)`로 캐시한다
    - HNSW 인덱스(`vector_cosine_ops`)를 만들고 RLS를 켠다
    - 임베딩 비용을 BudgetGuard와 `usage`에 합산한다
    - 가격표에 임베딩 단가를 추가한다
  - 검증: `npm test -w backend -- embedder`(fake 임베더, 비용 합산, 캐시 적중), `npm run test:db -- file-chunks`(저장, 인덱스 존재, RLS)
  - 관련: Constitution VI, research R13

- [ ] T057 pgvector 검색을 구현하고 Decide 후보를 보강한다: `backend/src/knowledge/retrieval.ts`, `backend/src/pipeline/explore-loop.ts`, `backend/src/llm/prompts/decide.ts`, `backend/tests/integration/retrieval.test.ts`
  - 의존: T056
  - 완료 조건:
    - 플래그가 켜져 있고 `candidate_count`가 설정 기준(기본 1,000)을 넘을 때만 동작한다
    - 목적별 섹션 지침과 Decide 커버리지 공백으로 질의를 만들고, 코사인 유사도 상위 k개 청크를 파일 단위로 묶어 Decide 입력에 "검색 추천 파일"로 넣는다
    - **선택은 여전히 Decide가 하고 코드가 검증한다**
    - 추천 출처는 `explored_files.reason`에 기록한다
  - 검증: `npm test -w backend -- retrieval` 통과(fake 임베딩으로 추천 주입, 플래그·기준 분기). 평가를 다시 실행해 대형 저장소 `keyFiles` 누락률 변화를 `expansion-gate.md`에 기록한다.
  - 관련: FR-009, Constitution I, II, research R13

- [ ] T058 지식 엔티티·관계 추출을 구현한다: `backend/src/llm/schemas.ts`(DecideOutput 확장), `backend/src/knowledge/entities.ts`, `backend/src/db/schema.ts`(`knowledge_entities`, `knowledge_relations`), `backend/tests/unit/entities.test.ts`
  - 의존: T054(지식 계열 진행 결정)
  - 완료 조건:
    - Decide 출력에 엔티티와 관계를 추가하고 스키마 깊이 3 이하를 유지한다
      - `entities[{name, kind: module|component|entrypoint|config|service|data_model|external_dependency, path, startLine, endLine}]`
      - `relations[{from, to, kind: imports|calls|configures|depends_on|exposes}]`
    - 코드 검증
      - 엔티티 근거 경로와 라인은 R8 규칙으로 검증하고, 실패하면 버린다
      - 이름을 정규화하고 중복을 병합한다
      - 양 끝 엔티티가 없는 관계는 버린다
    - 결과를 저장한다
  - 검증: `npm test -w backend -- entities` 통과. 잘못된 근거와 고아 관계 제거, 병합 규칙 확인.
  - 관련: Constitution IV(새 호출 지점 없음), V

- [ ] T059 Wiki 구조화를 구현한다(API·화면): `backend/src/knowledge/wiki.ts`, `backend/src/api/routes/analyses.ts`(`GET /api/analyses/{id}/wiki`), `frontend/src/components/WikiView.tsx`, `backend/tests/unit/wiki.test.ts`, `frontend/tests/WikiView.test.tsx`
  - 의존: T058
  - 완료 조건:
    - 엔티티, 관계, 파일 노트로 Wiki 페이지를 **결정적으로 조립한다**. 페이지는 구성 요소별로 만들고 요약, 관련 파일, 관계, 근거 퍼머링크를 담는다.
    - Write 입력에 Wiki 요약을 넣을 수 있게 한다(플래그)
    - 분석 화면에 "Wiki" 탭을 추가한다
  - 검증: `npm test -w backend -- wiki`, `npm test -w frontend -- WikiView` 통과. 모든 근거 링크가 작업 집합 경로를 가리킨다.
  - 관련: Constitution V

- [ ] T060 확장 기능의 근거 검증을 확장하고 효과를 측정한다: `backend/src/pipeline/citation-validator.ts`, `backend/tests/integration/knowledge-e2e.test.ts`, `specs/001-repo-manual-generator/eval/expansion-gate.md`
  - 의존: T057 또는 T059(진행한 계열)
  - 완료 조건:
    - 엔티티, Wiki, 검색 추천의 근거에도 R8 검증을 적용하는 통합 테스트를 작성한다
    - 플래그를 켠 경우와 끈 경우로 평가를 다시 실행해 게이트 지표, 비용, 시간을 비교·기록한다
    - 개선이 없으면 플래그 기본값을 `false`로 유지하고 그 근거를 기록한다
  - 검증: `npm test -w backend -- knowledge-e2e` 통과. `expansion-gate.md`에 전후 비교 수치와 최종 결정이 있다.
  - 관련: Constitution V, VI, VII

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 Setup**: 의존 없음
- **Phase 2 Foundational**: Phase 1 완료 후 시작한다. **모든 사용자 스토리를 막는다.** 내부 순서는 다음과 같다.
  - 공유 도메인 T007·T008
  - DB: T009 → T010
  - GitHub 수집: T012 → T013, T014 [P] → T015
  - LLM T016
  - 서버 T011
  - 워커 T017
- **Phase 3 US1 (MVP)**: Phase 2 완료 후 시작한다
- **Phase 4 US2 / Phase 5 US3 / Phase 6 US4**: US1 완료 후 시작한다. 셋은 서로 독립이라 병렬로 진행할 수 있다. 같은 파일 `routes/analyses.ts`와 `AnalysisPage.tsx`를 수정하므로 같은 파일 작업은 순서대로 병합한다.
- **Phase 7 US5**: US1 완료 후 시작한다. T043이 US3의 사용량 보호(T035)를 재사용하므로 **US3 이후**에 진행한다.
- **Phase 8 통합·검증**: 원하는 스토리를 모두 마친 뒤 진행한다. T047은 US1·US2만으로 시작할 수 있다.
- **Phase 9 조건부 확장**: T053 게이트 판정이 "진행"일 때만 진행한다. 검색 계열(T055~T057)과 지식 계열(T058~T059)은 서로 독립이다.

### User Story Dependencies

```text
Phase 1 ─▶ Phase 2 ─▶ US1(P1, MVP) ─┬─▶ US2(P2)
                                    ├─▶ US3(P2) ─▶ US5(P3)
                                    └─▶ US4(P3)
                    US1..US5 ─▶ Phase 8 ─▶ (게이트) ─▶ Phase 9
```

- US2, US3, US4, US5는 모두 US1의 파이프라인·API·분석 화면 위에 기능을 더하는 구조다. 이는 spec이 의도한 계층이다.
- 각 스토리는 자기 검증 작업(T032, T037, T041, T046)으로 독립 확인한다.

### Within Each Phase

- 순수 함수(파서, 필터, 검증기)를 먼저 만들고, 그다음 I/O 어댑터, 오케스트레이션, API, UI 순서로 진행한다
- 테스트는 같은 작업 안에서 작성하고, 작업의 "검증" 항목이 통과해야 완료다
- 프론트 작업은 shared 계약만 의존하므로 대응하는 백엔드 작업과 병렬로 진행할 수 있다. 실제 연결 확인은 각 스토리의 검증 작업에서 한다.

### Parallel Opportunities

- Phase 1: T002, T003, T004
- Phase 2: T007, T008, T012, T014, T016은 서로 병렬이다. DB 계열(T009 → T010)은 T007 완료 후 별도 흐름으로 진행한다.
- US1: T018, T019, T020은 병렬이다. T022는 T021과 병렬이다. T026은 백엔드 US1 작업 전체와 병렬이다.
- US2~US5: 프론트 작업 T031, T036, T039, T045는 각자 대응하는 백엔드 작업과 병렬이다
- Phase 9: T055~T057 계열과 T058~T059 계열은 병렬이다

---

## Parallel Example: User Story 1

```bash
# Phase 2 완료 직후, 서로 다른 파일의 순수 로직을 동시에 시작:
Task: "T018 BudgetGuard in backend/src/pipeline/budget.ts (+ tests/unit/budget.test.ts)"
Task: "T019 LLM 스키마·프롬프트 in backend/src/llm/schemas.ts, backend/src/llm/prompts/*"
Task: "T020 Decide 요청 검증기 in backend/src/pipeline/request-validator.ts"
Task: "T026 프론트 API 계층 in frontend/src/api/{client,queries}.ts"

# T021(탐색 루프) 진행 중 병렬:
Task: "T022 근거 검증·매뉴얼 조립 in backend/src/pipeline/{citation-validator,manual-assembler}.ts"
```

## Parallel Example: User Story 3

```bash
Task: "T033 실패 응답 안전성 in backend/src/api/routes/analyses.ts"
Task: "T034 엣지 케이스 in backend/src/pipeline/run-analysis.ts"
Task: "T036 요청 거절 표시 in frontend/src/components/RepoForm.tsx, FailureNotice.tsx"
# T035(사용량 보호)는 routes/analyses.ts와 run-analysis.ts를 T033·T034와 공유하므로 그 다음에 병합
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 Setup → `npm run dev`, `npm test` 동작
2. Phase 2 Foundational → 연결 ①②③ 확인 (DB, 실제 GitHub, 실제 Gemini 각각)
3. Phase 3 US1 → 연결 ④(워커 파이프라인) → ⑤(API) → ⑥(UI)
4. **STOP and VALIDATE**: T029에서 quickstart V1, V3, V4를 확인한다. 로컬에서 시연할 수 있다.

### Incremental Delivery

1. US1 → 로컬 MVP 시연
2. **US3 → 사용량 보호와 재시도 안내를 갖춘 뒤에야 외부 사용자에게 공개할 수 있다**
3. US2 → 근거·분석 내역 검증 경험
4. US4 → 링크 공유, 최근 목록, 만료
5. US5 → 재생성, 결과 재사용, 버전
6. Phase 8 → 평가 리포트, 보안·배포 점검, quickstart 정합
7. Phase 9 → 게이트를 통과한 계열만 플래그 뒤에서 도입하고 효과를 측정

### Agentic 요구사항 보장 장치 (정적 파이프라인 대체 방지)

- T021 검증 (e): 목적별로 Decide 요청이 달라지면 작업 집합이 달라지는지 확인
- T021 검증 (a)·(b): 충분성 판단에 따라 라운드 수가 1~3으로 달라지는지 확인
- T024: README가 빈약한 저장소에서 README 외 근거가 포함되는지 확인
- T047·T048: 실제 저장소에서 목적별 작업 집합 차이(Jaccard)와 README 외 근거 비율을 지표로 측정

---

## Notes

- [P] 작업은 다른 파일을 다루고 미완료 작업에 의존하지 않는다
- [Story] 라벨은 spec.md 사용자 스토리 추적용이다
- `verification-log.md`와 `eval/`은 검증 기록용 문서이며 코드가 아니다
- 작업이나 논리적 묶음마다 커밋하고, Checkpoint마다 멈춰 독립 검증한다
- 금지: `test.skip`·`.only`, 스텁 테스트, TODO 남기기(T052에서 검사), 같은 파일을 여러 작업이 동시에 수정하는 것
