# Verification Log

**Feature**: [spec.md](./spec.md) | **Tasks**: [tasks.md](./tasks.md)

수동·통합 검증 기록이다. 자동 테스트 결과는 각 작업의 "검증" 항목에서 확인한다.

---

## T029 — US1 통합 검증 (2026-10-22)

### 환경

- 실행: `npm run dev` (백엔드 8787 + Vite 5173). 요청은 브라우저와 같은 경로인 Vite 프록시(5173)로 보냈다.
- 외부 서비스: 실제 GitHub REST API(Fine-grained PAT), Gemini API, Supabase Postgres(서울)
- 모델: Decide `gemini-3.5-flash-lite`, Write `gemini-3.8-flash`, 둘 다 `thinking_level: low`
- 한도: 기본값(research R5), `WORKER_CONCURRENCY=2`
- 검증 스크립트: 분석 세 건을 동시에 요청하고, 화면처럼 2초마다 상태를 조회해 진행 갱신 간격을 측정한 뒤 매뉴얼을 받아 비교했다.

### 대상 저장소

`https://github.com/academind/node-restful-api-tutorial`
- README 453바이트(빈약한 README), JavaScript
- 기본 브랜치 `01-basic-setup`, 분석 커밋 `e00ce89`
- URL에 브랜치가 없어 기본 브랜치로 해석되었다(정상).

### 결과

| 시나리오 | 분석 ID | 수준·목적 | 첫 상태 | 소요 | 결과 | 진행 무갱신 최대 | 대기 순서 |
|---|---|---|---|---|---|---|---|
| V1 | `c520599e-6f5e-45c2-b42a-3c354005e45e` | 입문자 · 설치 및 실행 | 0.85초 | 97초 | completed | 10초 | 1 |
| V3 | `77adc00f-1629-433b-87e3-f21d2513e77f` | 일반 개발자 · 프로젝트 이해 | 0.75초 | 69초 | completed | 10초 | 2 |
| V4 | `a1251679-2617-4671-bc99-ca04361d874c` | 바이브 코딩 · 코드 수정 및 확장 | 0.75초 | 128초 | completed | 7초 | 3 → 1 |

진행 단계는 세 건 모두 `저장소 확인 → 구조 파악 → 파일 선택(AI 판단) → 파일 분석(읽기 → AI 판단) → 매뉴얼 작성` 순서로 관찰되었다.

### 판정

| 항목 | 기준 | 결과 |
|---|---|---|
| SC-002 첫 진행 상태 | 5초 이내 | ✅ 0.75~0.85초 |
| SC-002 진행 갱신 | 실행 중 30초 이상 무갱신 없음 | ✅ 최대 10초(하트비트 간격) |
| 대기 표시 | 대기 순서 표시 | ✅ 동시 3건 중 3번째가 3 → 1로 줄어듦 |
| V1 섹션 | setup 6개 섹션 | ✅ 6개(found 4, partial 2) |
| V1 입문자 단계 | 단계마다 정상 결과·실패 대처 | ✅ step 6개 모두 expectedResult·troubleshooting 있음 |
| FR-008 README 외 근거 | README 외 파일 인용 | ✅ 세 건 모두 `package.json`, `server.js`, `app.js` 인용 |
| FR-024 근거 링크 | 분석 커밋 SHA로 고정 | ✅ 모든 근거 URL이 `/blob/e00ce89…/` |
| V3 수준 차이 | 일반 개발자는 기초 설명 없음 | ✅ 용어 풀이·선행 지식 없음, 확인됨 8 / 추론 1 |
| V4 바이브 코딩 | 맥락·관련 파일·요청 예시·체크리스트 | ✅ 맥락 390자, 관련 파일 3, 요청 예시 3, 체크리스트 4 |
| V1 입문자 추가 요소 | 용어 풀이·선행 지식 | ✅ 용어 5, 선행 지식 2 |
| 화면 렌더링(연결 ⑥) | 실제 매뉴얼이 화면 컴포넌트에서 렌더링 | ✅ 실제 응답 JSON 세 개를 `ManualView`에 넣어 렌더링 확인(섹션 수 일치, 모든 링크 https) |

### 관찰

- V1(입문자)은 확인됨 3 / 추론 7이다. 저장소에 `start` 스크립트와 Node 버전 정보가 없어서 일반 관행 기반 안내가 추론으로 표시되었다. 매뉴얼 한계 문구도 이 점을 밝힌다. 의도한 동작이다.
- 사람이 브라우저 화면을 직접 보는 확인은 하지 않았다. 위 분석 결과는 30일간 보관되므로 `npm run dev` 후 `http://localhost:5173/a/<분석 ID>`로 열어 볼 수 있다.

### 같은 날 앞선 실행 (vercel/ms, 입문자 · 설치 및 실행)

| 실행 | 결과 | 소요 | 비용 | 비고 |
|---|---|---|---|---|
| 1차 | completed | 70초 | $0.0158 | Decide #1이 이미 읽은 시드만 다시 요청해 탐색이 바로 끝남. README와 package.json만으로 작성됨 → 탐색 루프 보정(research R1) |
| 2차(보정 후) | completed | 288초 | $0.0542 | Decide #1이 `src/index.ts`, `tsconfig.json`을 골라 읽고, Decide #2가 sufficient. Write(출력 12.5k 토큰)에 약 4.6분 |

### 위험

- **SC-001(5분 이내) 위험**: `gemini-3.8-flash` Write 지연의 편차가 크다. 같은 날 69~128초(academind)와 약 4.6분(vercel/ms)을 관찰했다. 출력이 길수록 느려진다. Phase 8 평가(T047·T048)에서 분포를 측정하고, 기준을 넘으면 `LLM_MAX_OUTPUT_WRITE` 축소나 Write 모델 변경을 검토한다.

---

## T032 — US2 근거 확인 검증 (2026-10-22)

자동 테스트 `backend/tests/integration/citations-e2e.test.ts`가 통과했다. 가짜 LLM이 존재하지 않는 경로, 범위를 넘은 라인, 근거 없는 사실을 섞어 보내도 저장된 매뉴얼의 확인됨 블록은 모두 유효한 근거를 가졌다. 근거를 잃은 블록 3개는 추론으로 강등되어 `stats.downgraded=3`으로 기록되었고, 근거 경로는 모두 `/trace` 파일 목록에 있었다.

수동 시나리오는 T029의 실제 분석 결과로 수행했다. 백엔드를 띄워 `/trace`와 `/manual`을 받고 GitHub 원문과 대조했다.

| 시나리오 | 대상 | 결과 |
|---|---|---|
| V2 README 단독 금지 | academind 3건, vercel/ms 1건 | ✅ 네 건 모두 README 외 파일(`app.js`, `server.js`, `src/index.ts`, `tsconfig.json`)이 출처(AI 요청)·라운드·선택 이유와 함께 표시됨. Decide #1이 이미 읽은 시드를 다시 요청한 기록은 `already_read`로 남음 |
| V5 근거 링크 | 같은 4건의 매뉴얼 근거 55개 | ✅ 55/55가 분석 커밋 기준 실제 파일의 줄 수 안을 가리킴. 모든 근거 경로가 `/trace`에 있음. 링크는 HTTP 200 |
| V6 확인되지 않음 | academind · 바이브 코딩 · 코드 수정 및 확장 (저장소에 테스트 파일 없음) | ✅ 테스트 명령을 지어내지 않음. "변경 검증 방법" 섹션은 "`test` 스크립트가 `no test specified`라 자동 테스트가 없다"를 `package.json:6-8` 근거로 밝히고, 서버를 띄워 응답을 확인하는 절차를 `app.js` 근거로 제시함(상태 partial). quickstart가 예상한 "저장소에서 확인되지 않음" 표시와는 다르다. 검증 방법 자체는 근거로 확인되었으므로 FR-022에 맞는 결과로 본다 |

### 발견해 고친 문제

- 확인된 사실 없이 추론 블록만 있는 섹션(T029 V1의 "실행 환경" 등)이 화면에 "일부만 확인됨"으로 표시되었다. FR-022는 근거를 찾지 못한 항목을 "저장소에서 확인되지 않음"으로 표시하라고 정한다. 이제 사실이 없는 섹션은 "저장소에서 확인되지 않음 — 아래는 일반적인 관행에 따른 안내입니다"를 먼저 보여 주고 추론 블록을 덧붙인다(`SectionView`, 테스트 추가).

---

## T037 — US3 실패·부분 완료·사용량 보호 검증 (2026-10-22)

환경 변수로 한도를 바꿔 백엔드를 다시 띄우고 실제 GitHub·Gemini·Supabase로 수행했다. 시나리오끼리 요청 수 집계가 섞이지 않도록 `TRUST_PROXY=true`와 `X-Forwarded-For`로 접속 출처를 나눴다. 요청 제한 시나리오는 AI 비용이 들지 않도록 존재하지 않는 저장소로 보냈다.

| 시나리오 | 설정 | 결과 |
|---|---|---|
| V7 잘못된 URL | 기본 | ✅ `https://gitlab.com/a/b` → 400 "GitHub 저장소 주소만 지원합니다." + 형식 예시, `github.com/onlyowner` → 400 "소유자와 저장소 이름이 모두 들어간 주소를 입력해 주세요." |
| V8 없는 저장소 | 기본 | ✅ failed / `repo_not_found_or_private`, 고정 문구와 조치 표시 |
| V9 한도 도달 | 라운드 1, 파일 4, express · 일반 개발자 · 코드 수정 및 확장 | ✅ partial(`round_limit`), 읽은 파일 4개, `limitReached=true`, 비용 $0.0299 |
| V14 프롬프트 인젝션 | — | ⏸ 직접 소유한 공개 테스트 저장소가 필요해 실제 실행은 보류. 자동 테스트(T021 (f): 인젝션 README가 모든 파일을 요청해도 라운드·파일 한도로 잘림)로 확인 |
| V15 요청 제한 | 출처당 하루 2회 | ✅ 1·2번째 202, 3번째 429 "오늘 분석 요청 한도(24시간에 2회)…" + 재시도 시각, 다른 출처는 202 |
| V16 중복 요청 | 기본 | ✅ (수정 후) 동시에 보낸 같은 요청이 같은 ID를 받고 두 번째는 `deduplicated=true` |
| V17 일일 비용 상한 | 하루 $0.01 | ✅ 503 `daily_budget_exhausted` + "한국 시간 자정 이후 다시 시도" + 자정까지 남은 초 |

### 발견해 고친 문제

- **중복 요청 경쟁 조건(V16 1차 실패)**: 같은 요청 두 건을 동시에 보내면 분석이 두 개 만들어졌다. 진행 중인 요청 확인과 생성이 따로 실행됐기 때문이다. 이제 요청 수·일일 비용 확인과 같은 advisory lock 트랜잭션 안에서 중복을 확인한다(`createWithQuota`, 회귀 테스트 추가).
- **Decide #1이 시드만 다시 요청(V9 1차 실패)**: 라운드 한도 1에서 Decide #1이 README·package.json만 다시 요청해 시드 외 파일을 하나도 읽지 못했다. Decide #1에 원문을 주지 않은 설계 탓이었다. 시드 원문을 Decide #1에 바로 넣도록 바꿨다(research R1 갱신, 회귀 테스트 추가). 바꾼 뒤 express · 설치 및 실행은 README만으로 sufficient가 되어, V9는 더 많은 파일이 필요한 목적(코드 수정 및 확장)으로 수행했다.

### 관찰

- AI는 프롬프트의 남은 예산을 지켜 상한보다 많이 요청하지 않았다(V9에서 요청 2건 = 남은 파일 수). 그래서 실제 실행에서는 `over_file_limit` 거절이 기록되지 않았다. 예산을 넘는 요청을 코드가 거절하는 경로는 자동 테스트(T020, T021 (c)(d)(f))로 검증했다.
- 실제 Postgres 동시성 테스트(`tests/db/limits.test.ts`)는 `TEST_DATABASE_URL`이 없어 실행하지 못했다.

---

## T041·T046 — US4 재조회·US5 재생성 검증 (2026-10-22)

실제 서버(API + 워커)를 띄우고 T029에서 만든 분석 `c520599e-…`(academind, 입문자 · 설치 및 실행)으로 수행했다.

| 시나리오 | 결과 |
|---|---|
| V10 재조회 | ✅ 상세 447ms + 매뉴얼 301ms(3초 이내, SC-009). 조회 전후 사용량 변화 없음(파이프라인 미실행). 링크만으로 조회하므로 브라우저 저장소가 없는 시크릿 창에서도 같은 응답을 받는다 |
| V11 진행 중 이탈 | ✅ 재생성 분석을 `selecting_files/llm_deciding`에서 조회를 멈췄다가 20초 뒤 다시 조회하니 `writing_manual/llm_writing`으로 진행되어 있었다(서버 측 워커가 계속 처리) |
| V12 수준 변경 재생성 | ✅ 입문자 → 일반 개발자. completed. 부모 파일 4개(`app.js`, `package.json`, `README.MD`, `server.js`)를 `reused`로 재사용하고 새로 읽은 파일 0개, **GitHub 호출 0회**(부모 7회), 비용 $0.0087(부모의 약 1/3). 부모 매뉴얼은 바뀌지 않았고 부모의 버전 목록이 2개가 됐다 |
| 최신 커밋 확인 | ✅ 새 커밋이 없어 `isOutdated=false`, `refresh_commit` 요청은 409 `already_latest` |
| V13 최신 커밋 재분석 | ⏸ 직접 소유한 공개 테스트 저장소에 커밋을 추가해야 해서 실제 실행은 보류. 새 커밋이 있을 때 새 스냅샷으로 처음부터 분석하는 경로는 자동 테스트(`regeneration.test.ts`, `api-regenerations.test.ts`)로 확인 |

브라우저 화면 확인(최근 목록, 만료 화면, 재생성 패널, 버전 목록, 375px 폭)은 컴포넌트 테스트로만 했고 사람이 직접 보지는 않았다.

---

## T050 — 보안 점검 (2026-10-22)

| 항목 | 결과 |
|---|---|
| 로그 마스킹 | ✅ `backend/tests/unit/security.test.ts`: `Authorization`·`Cookie` 헤더가 `[redacted]`로 기록되고 원문이 남지 않음 |
| 프론트엔드 비밀값 | ✅ `frontend/src`와 빌드 산출물 `frontend/dist`에 키·토큰·DB 접속 문자열 패턴 없음. 브라우저 코드가 읽는 사용자 정의 환경 변수(`import.meta.env.*`) 없음 |
| 오류 응답 | ✅ 내부 예외 메시지·스택·외부 응답 원문이 응답에 섞이지 않음(`api-failure-safety`, `api-health` 테스트) |
| 마크다운 XSS | ✅ 원시 HTML 미렌더링, `javascript:` 링크 제거(`ManualView` 테스트) |
| `.env.example` | ✅ 비밀값 칸이 비어 있음 |
| `.env` 추적 | ✅ git에 추적되지 않음 |
| `npm audit --audit-level=high` | ✅ high 이상 0건. moderate 4건은 모두 개발 도구 경로(drizzle-kit → @esbuild-kit → esbuild 개발 서버)라 배포 코드에 포함되지 않음 |
| Supabase | ✅ 모든 테이블 RLS 활성(정책 없음), 클라이언트 키 미사용 |

## T051 — 프로덕션 실행 점검 (2026-10-22)

`npm run build` 후 `NODE_ENV=production npm start`로 실행했다.

| 항목 | 결과 |
|---|---|
| `/api/health` | ✅ `{"ok":true,"db":"ok"}` |
| `/` | ✅ 200, 빌드된 화면 |
| `/a/{id}` 직접 접근 | ✅ 200, SPA fallback으로 `index.html` |
| 정적 자산 | ✅ `/assets/*.js` 200 |
| API | ✅ 분석 상세 조회 정상, 없는 API 경로는 JSON 404 |

발견: `NODE_ENV=production`이 없으면 화면을 서빙하지 않고 `127.0.0.1`에만 열린다. quickstart 6장과 `.env.example`에 배포 시 필수 값으로 추가했다.

공개 전 점검표(사용자 확인 필요): Gemini 결제 등급(Tier 1) 전환, GitHub 토큰 만료일 기록, 예산 알림, `TRUST_PROXY=true`, IPv4 전용 호스트면 Session pooler 문자열, 한도 값. 배포 여부와 호스팅 선택은 사용자 결정 사항이다.
