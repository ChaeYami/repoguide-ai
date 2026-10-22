# Implementation Plan: Agentic 개인 맞춤 저장소 매뉴얼 생성

**Branch**: `001-repo-manual-generator` | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-repo-manual-generator/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

공개 GitHub 저장소 URL과 사용자 수준(입문자, 바이브 코딩, 일반 개발자), 목적(이해, 설치·실행,
수정·확장)을 받아 근거가 연결된 맞춤 매뉴얼을 만드는 웹사이트다.

분석은 **코드가 제어하는 단일 탐색 루프**로 수행한다.
- 결정적 코드: 저장소 조회, 커밋 고정, 트리 필터, 시드 선택, 한도 강제, 인용 검증, 저장
- Gemini 판단(호출 지점 2개):
  - Decide (`gemini-3.5-flash-lite`): 다음에 읽을 파일과 충분성 판단. 최대 3라운드
  - Write (`gemini-3.8-flash`): 수준·목적별 매뉴얼 작성
- LLM 출력은 구조화 JSON으로 받아 코드가 검증한 뒤에만 사용한다. 근거가 검증되지 않은 "사실"은
  "추론"으로 강등한다.
- 실행당 비용 $0.30, 서비스 일일 $5, 접속 출처당 하루 10회의 상한을 코드가 강제한다.

구현 형태:
- 화면: React, Vite, Tailwind로 만든 2개 화면
- 서버: Node(Fastify) 단일 서비스가 API, 인프로세스 워커, 정적 파일을 모두 처리한다
- 저장소: Supabase Postgres. pgvector는 활성화만 하고 사용하지 않는다

## Technical Context

**Language/Version**: TypeScript 5.x (strict), Node.js 24 LTS

**Primary Dependencies**:
- Backend:
  - 서버: Fastify 5, `@fastify/static`
  - 검증: zod 4 (JSON Schema 변환 포함)
  - AI: `@google/genai` ≥ 2.3.0 (Interactions API)
  - DB: Drizzle ORM과 drizzle-kit, `postgres`(postgres.js)
  - GitHub: Node 내장 `fetch` (SDK 없음)
- Frontend: React 19, Vite, Tailwind CSS v4(`@tailwindcss/vite`), React Router, TanStack Query,
  react-markdown
- Shared: zod (API·Manual 스키마, URL 파서)
- 개발: npm workspaces, tsx, concurrently

**Storage**:
- Supabase PostgreSQL. 연결은 Direct 또는 Session pooler(5432)로 한다
- pgvector 확장은 활성화하고 MVP에서는 사용하지 않는다
- 최근 분석 목록은 브라우저 localStorage에 둔다

**Testing**:
- Vitest (backend·frontend 공통), React Testing Library
- Fake GitHub와 Fake LLM 기반 파이프라인 통합 테스트
- `TEST_DATABASE_URL` 기반 DB 통합 테스트
- 실제 API 평가 스크립트(`npm run eval`)

**Target Platform**:
- Node 24 상시 실행 서버(개발은 Windows, 배포는 Linux 호스팅)
- 최신 데스크톱·모바일 브라우저

**Project Type**: Web application (frontend + backend + shared 패키지, 단일 서비스로 배포)

**Performance Goals** (spec SC 기준):
- 파일 1,000개 이하 저장소의 90%가 5분 안에 완료 (SC-001)
- 첫 진행 상태 5초 이내, 무갱신 구간 30초 미만 (SC-002, 2초 폴링)
- 재조회 3초 이내 (SC-009)

**Constraints**:
- 한도는 research R5 기준이다: 라운드 3, 파일 40, 원문 30만 자, GitHub 호출 80, 실행당
  $0.30, 일일 $5, 접속당 10회/일, 실행 600초
- GitHub PAT는 시간당 5,000회다
- Gemini 요청 한도는 등급에 따른다(기본 `WORKER_CONCURRENCY=2`)
- 공개 저장소만 분석하고 로그인은 없다
- 결과는 30일 보관한다

**Scale/Scope**:
- MVP는 단일 인스턴스, 하루 약 25~40회 분석(일일 비용 상한 기준)
- 화면 2개(홈, 분석 결과), API 엔드포인트 8개(헬스 체크 포함), LLM 호출 지점 2개

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Constitution v1.0.0 "개발 워크플로 및 품질 게이트"의 필수 게이트와 보안 제약을 평가했다.

| 게이트 | 원칙 | 판정 | 근거 |
|--------|------|------|------|
| G1. 결정적 처리와 LLM 판단 영역 분리 | III, IV | ✅ PASS | LLM 호출 지점은 Decide와 Write 2개뿐이다([contracts/llm-io.md](./contracts/llm-io.md)). GitHub 호출, 필터, 시드, 요청 검증, 한도, 인용 검증, 상태 판정, 사용자 오류 문구는 모두 코드가 처리한다(research R1, R6~R8) |
| G2. 파일 선택·추가 탐색의 근거 기록 | I, II | ✅ PASS | 파일마다 `explored_files.reason`과 `source`를 남긴다. Decide 호출마다 `exploration_rounds`에 요청, 수락·거절 사유, 커버리지, sufficient를 남긴다. 화면의 "분석 내역"(`/trace`)으로 공개한다 |
| G3. 파일 연결, 인용 검증, 사실·추론 구분 | V | ✅ PASS | 블록마다 `kind`와 `evidence`를 둔다. 코드가 작업 집합 포함 여부와 라인 범위를 검증하고, 근거 없는 fact는 강등한다. 커밋 SHA 퍼머링크를 붙이고 분석 커밋을 기록한다(R8, [contracts/manual.md](./contracts/manual.md)) |
| G4. 탐색·파일·토큰·비용 한도와 강제 지점 | VI | ✅ PASS | 한도는 환경 변수로 두고 실행 시작 시 스냅샷한다. `BudgetGuard`가 모든 GitHub·LLM 호출 직전에 사전 추정으로 검사한다. 한도에 도달하면 부분 완료로 정상 종료하고 사용량을 기록한다(R5) |
| G5. 에이전트·단계 추가의 근거 | VII | ✅ PASS | 단일 루프와 역할 2개로 구성했다. 에이전트 프레임워크, 다중 에이전트, Critic 단계, pgvector 검색은 도입하지 않고 도입 조건만 기록했다(R13, R24) |
| S1. 저장소 내용을 신뢰할 수 없는 입력으로 취급 | 보안 | ✅ PASS | FILE 블록 구분자, 시스템 지시, 스키마로 출력 제한, 결정 권한을 코드에 둠, 원시 HTML 미렌더링(R9) |
| S2. 저장소 코드 미실행 | 보안 | ✅ PASS | 파일 읽기만 한다. 실행 경로가 없다 |
| S3. 비밀값은 서버에서만 다룸 | 보안 | ✅ PASS | 키는 백엔드 `.env`에만 둔다. `VITE_*`에는 비밀값을 두지 않는다. 로그에서 마스킹한다. Supabase 클라이언트 키는 쓰지 않는다. RLS를 켜고 정책을 두지 않는다(R12) |
| S4. GitHub 한도·오류를 이해 가능한 문구로 안내 | 보안 | ✅ PASS | 레이트리밋 헤더로 판단해 `github_rate_limited`와 재시도 시각을 안내한다. 실패 코드별 고정 문구를 쓴다([contracts/http-api.md](./contracts/http-api.md)) |
| W1. 결정적 처리 코드의 자동화 테스트 | 워크플로 | ✅ PASS | 단위 테스트 대상 목록을 R21에 정의했다. tasks 단계에서 각 모듈의 테스트 작업으로 분해한다 |

**결과**: 위반 없음. Phase 0으로 진행한다.

## Agentic 실행 구조 (요약)

자세한 비교와 근거는 [research.md](./research.md) R1·R2에 있다.

```text
POST /api/analyses ─▶ analyses(queued) ─▶ 인프로세스 워커가 획득(SKIP LOCKED + 임대)
  validating_repo     [코드] URL·ref 해석, 공개 확인, 커밋 SHA 고정
  scanning_structure  [코드] 트리 수집 → 필터 → 스택 감지 → 시드(README·매니페스트) 결정
  selecting_files     [LLM Decide #1] 트리 + 수준·목적 → 요청 ─▶ [코드] 요청 검증·거절 사유 기록
  reading_files       [코드] Round 1 읽기 ─▶ [LLM Decide #2] 노트·커버리지·sufficient·추가 요청
  exploring_more      (sufficient=false & 한도 남음) [코드] Round 2·3 읽기 ─▶ [LLM Decide #3]
  writing_manual      [LLM Write] 원문 + 노트 + 수준 가이드 + 섹션 카탈로그
                      ─▶ [코드] 스키마 검증 → 인용 검증·강등 → 누락 섹션 채움 → 퍼머링크 → 상태 판정
  done                completed | partial(사유) | failed(코드·안내)
```

## 요구사항 → 설계 매핑

| 요구사항 | 설계 요소 |
|----------|-----------|
| FR-001·002 URL 입력·검증 | `shared/src/repo-url.ts`를 프론트 즉시 검증과 API 검증에 함께 쓴다. ref 모호성은 R6 규칙으로 해석한다 |
| FR-003~005 수준·목적 선택 | 홈 화면 `LevelPicker`·`PurposePicker` (한 줄 설명 포함), `POST /api/analyses` |
| FR-006 공개 저장소만 | 공개 읽기 전용 PAT, `validating_repo`에서 `private`/404 처리 → `repo_not_found_or_private` |
| FR-007~011 구조 파악·동적 선택·제외·선택 이유 | `github/tree-filter`, `stack-detect`, `tree-listing`, Decide, `explored_files` |
| FR-012 충분성 판단·추가 탐색 | Decide `sufficient`·`requests`, 탐색 루프 (R1) |
| FR-013·014 한도·사용량 기록 | `pipeline/budget.ts`, `analyses.limits`·`usage` |
| FR-015·016 인젝션·미실행 | R9, 실행 경로 없음 |
| FR-017 커밋 고정 | `repo_snapshots.commit_sha`, 모든 읽기와 퍼머링크에 SHA 사용 |
| FR-018·019 진행 상태·이탈 후 복귀 | `analyses.stage`·`progress`, 2초 폴링, 서버 측 워커 |
| FR-020~023 섹션·수준·미확인·한국어 | 섹션 카탈로그와 수준 가이드(코드 상수), Write, Manual 조립 |
| FR-024~027 근거·사실/추론·분석 내역 | R8 인용 검증기, `EvidenceChip`·`FactBadge`, `GET /trace` |
| FR-028·029 상태·원인·안전한 문구 | `failure_code`·`partial_reasons`와 고정 문구 매핑 |
| FR-030·031 링크·최근 목록·재조회 | UUID 링크 `/a/{id}`, localStorage, `GET /api/analyses?ids=` |
| FR-032·033 재생성·버전 보존 | `POST /regenerations`, `parent`/`root` 계보, `GET /freshness`, 스냅샷 재사용 |
| FR-034 요청 제한 | 해시된 접속 키, 24시간 집계 |
| FR-035 일일 비용 상한 | 일일 비용 예약(진행 중 예약액 포함), KST 자정 기준 |

## Project Structure

### Documentation (this feature)

```text
specs/001-repo-manual-generator/
├── plan.md              # 이 문서
├── research.md          # Phase 0: 결정·근거·대안 (R1~R24)
├── data-model.md        # Phase 1: 테이블·enum·상태 전이
├── quickstart.md        # Phase 1: 외부 설정·로컬 실행·검증 시나리오
├── contracts/
│   ├── http-api.md      # REST API 계약
│   ├── manual.md        # 매뉴얼 문서 구조·불변식
│   └── llm-io.md        # Decide/Write 입출력 계약 (코드↔LLM 경계)
├── checklists/
│   └── requirements.md  # spec 품질 체크리스트
└── tasks.md             # Phase 2 (/speckit-tasks에서 생성)
```

### Source Code (repository root)

```text
package.json               # npm workspaces: shared, backend, frontend / 루트 스크립트(dev, build, start, test, eval, db:migrate)
tsconfig.base.json
.env.example               # 변수 이름만 (값 없음)
.gitignore                 # .env, dist, node_modules

shared/
└── src/
    ├── enums.ts           # Level, Purpose, Status, Stage, FailureCode, PartialReason ...
    ├── repo-url.ts        # GitHub URL 파서·정규화 (프론트·백엔드 공용)
    ├── api.ts             # 요청·응답 zod 스키마 (contracts/http-api.md)
    ├── manual.ts          # Manual zod 스키마 (contracts/manual.md)
    ├── sections.ts        # 목적별 섹션 카탈로그 (id, 한국어 제목, 작성 지침)
    └── index.ts

backend/
├── src/
│   ├── index.ts           # 부트스트랩: env → db → API 서버 → 워커 → 정리 작업
│   ├── config/
│   │   ├── env.ts         # 환경 변수 zod 검증
│   │   ├── limits.ts      # 한도 기본값·로딩 (R5)
│   │   └── pricing.ts     # 모델별 단가 (적용 시작일 포함)
│   ├── api/
│   │   ├── server.ts      # Fastify 앱, 정적 서빙, 오류 매핑
│   │   ├── routes/analyses.ts
│   │   ├── routes/health.ts
│   │   ├── messages.ts    # failure/partial 코드 → 한국어 고정 문구
│   │   └── client-key.ts  # IP 해시, 요청 제한, 일일 예산 예약
│   ├── github/
│   │   ├── client.ts      # fetch 래퍼, 레이트리밋·오류 매핑
│   │   ├── resolve-ref.ts # ref 해석·커밋 고정
│   │   ├── tree-filter.ts # 제외 규칙
│   │   ├── seeds.ts       # 시드 파일 선택
│   │   ├── stack-detect.ts
│   │   ├── tree-listing.ts# LLM용 목록 압축·디렉터리 펼치기
│   │   └── permalink.ts
│   ├── llm/
│   │   ├── client.ts      # LlmClient 인터페이스
│   │   ├── gemini-client.ts # Interactions API 어댑터, 재시도, 사용량 추출
│   │   ├── schemas.ts     # DecideOutput, WriteOutput (zod → JSON Schema)
│   │   ├── cost.ts        # 사전 추정·실비 계산
│   │   └── prompts/
│   │       ├── decide.ts
│   │       ├── write.ts
│   │       ├── level-guides.ts
│   │       └── file-block.ts  # FILE 구분자·라인 번호 포맷
│   ├── pipeline/
│   │   ├── run-analysis.ts    # 오케스트레이터 (단계 전이·상태 판정)
│   │   ├── budget.ts          # BudgetGuard
│   │   ├── explore-loop.ts    # Decide ↔ 읽기 루프, 요청 검증
│   │   ├── file-reader.ts     # 읽기·바이너리 판별·절단·캐시
│   │   ├── write-manual.ts    # Write 입력 구성·원문 우선순위·축소
│   │   ├── citation-validator.ts
│   │   ├── manual-assembler.ts
│   │   └── progress.ts        # stage/progress 갱신
│   ├── jobs/
│   │   ├── worker.ts          # 작업 획득·임대·하트비트·재시도
│   │   └── cleanup.ts         # 만료 처리 (R17)
│   └── db/
│       ├── schema.ts          # Drizzle 스키마 (data-model.md)
│       ├── client.ts
│       └── repositories/      # analyses, snapshots, rounds, files, manuals
├── drizzle/                   # 생성된 SQL 마이그레이션 (+ vector 확장, RLS 활성화)
├── scripts/
│   ├── eval.ts                # 실제 API 평가 리포트
│   └── eval-repos.json
└── tests/
    ├── unit/                  # 결정적 모듈별 테스트 (R21)
    ├── integration/           # Fake GitHub + Fake LLM 파이프라인
    ├── db/                    # TEST_DATABASE_URL 필요
    └── fixtures/github/       # 저장소 트리·파일 고정 데이터 (인젝션 샘플 포함)

frontend/
├── index.html
├── vite.config.ts             # react, tailwind 플러그인, /api 프록시
├── src/
    ├── main.tsx
    ├── App.tsx                # 라우트: /, /a/:id, *
    ├── pages/
    │   ├── HomePage.tsx
    │   ├── AnalysisPage.tsx   # 상태별: 진행 / 매뉴얼 / 실패 / 만료
    │   └── NotFoundPage.tsx
    ├── components/
    │   ├── RepoForm.tsx, LevelPicker.tsx, PurposePicker.tsx, RecentList.tsx
    │   ├── ProgressStepper.tsx
    │   ├── ManualView.tsx, SectionView.tsx, BlockView.tsx, LevelExtrasView.tsx
    │   ├── FactBadge.tsx, EvidenceChip.tsx, NotFoundNotice.tsx
    │   ├── PartialBanner.tsx, FailureNotice.tsx
    │   ├── TracePanel.tsx
    │   ├── RegeneratePanel.tsx, FreshnessBanner.tsx, VersionSwitcher.tsx
    │   └── SafeMarkdown.tsx   # 원시 HTML 비활성, http(s) 링크만
    ├── api/
    │   ├── client.ts          # fetch 래퍼, ErrorResponse 처리
    │   └── queries.ts         # TanStack Query 훅 (폴링 포함)
    ├── lib/
    │   ├── recent-store.ts    # localStorage (try/catch)
    │   └── labels.ts          # 한국어 라벨
    └── styles/index.css
└── tests/                     # 컴포넌트·스토어 테스트
```

**Structure Decision**: 템플릿의 "Web application" 구조에 `shared/` 패키지를 더했다.
`shared`는 URL 파서, 스키마, 섹션 카탈로그처럼 프론트와 백엔드가 **같은 규칙을 써야 하는
결정적 코드**를 한 곳에 둔다. 배포는 `backend`가 `frontend/dist`를 서빙하는 단일 Node 서비스로
한다(research R22). `backend/src`는 Constitution III·IV의 경계에 맞춰 나눈다.
- `github/`, `pipeline/`, `jobs/`, `db/`: 결정적 코드
- `llm/`: LLM 어댑터와 프롬프트

## Post-Design Constitution Re-check

Phase 1 산출물(data-model, contracts, quickstart) 작성 후 다시 평가했다.

| 게이트 | 판정 | 설계 산출물에서의 확인 지점 |
|--------|------|-----------------------------|
| G1 | ✅ | [llm-io.md](./contracts/llm-io.md)에 호출 지점이 2개로 고정되어 있다. 출력 후처리 규칙이 모두 코드에 정의되어 있다. 사용자 오류 문구는 LLM이 아닌 고정 매핑이다 |
| G2 | ✅ | `exploration_rounds.requests[].rejectReason`, `explored_files.reason/source`가 있다. `/trace` 응답 계약에 노출된다 |
| G3 | ✅ | [manual.md](./contracts/manual.md) 불변식 1~5를 지킨다. `snapshot_files.line_count`가 검증 기준이다. 퍼머링크에 SHA를 쓴다 |
| G4 | ✅ | `analyses.limits`·`usage`·`reserved_cost_usd`가 있다. 불변식 `usage.costUsd ≤ limits.maxCostUsdPerRun`을 테스트로 검증한다. quickstart V9·V15로 수동 검증한다 |
| G5 | ✅ | 새 에이전트나 단계를 추가하지 않았다. 확장 후보는 측정 조건과 함께 R24에만 있다 |
| S1~S4, W1 | ✅ | quickstart V14(인젝션), 환경 변수 규칙(2장), RLS(1.3), 테스트 범위(4장)로 확인한다 |

**결과**: 위반 없음. `/speckit-tasks`로 진행할 수 있다.

## Complexity Tracking

> Constitution Check 위반이 없으므로 정당화가 필요한 항목은 없다.

참고로, 복잡도를 늘릴 수 있는 확장 후보(pgvector 의미 검색, Critic 단계, 결과 즉시 재사용, SSE,
분리 워커, 상위 Write 모델, 지식 엔티티·관계 추출, Wiki 구조화)는 [research.md](./research.md) R13·R24에 **도입 조건(측정 기준)과
함께** 기록했다. 조건이 충족되면 이 표에 근거를 기록한 뒤 도입한다.
