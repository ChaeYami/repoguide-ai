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
