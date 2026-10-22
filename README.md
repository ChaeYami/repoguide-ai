# RepoGuide AI

GitHub 저장소 URL을 넣으면 AI가 저장소의 실제 코드와 문서를 탐색해, 사용자 수준(입문자 · 바이브 코딩 개발자 · 일반 개발자)과 목적(프로젝트 이해 · 설치 및 실행 · 코드 수정 및 확장)에 맞는 매뉴얼을 만드는 웹사이트입니다.

- README만 읽지 않습니다. 파일 구조를 보고 AI가 필요한 파일을 골라 읽고, 정보가 부족하면 한도 안에서 더 탐색합니다.
- 매뉴얼의 주요 설명마다 근거 파일·라인 링크(분석한 커밋으로 고정)가 붙고, 확인된 사실과 추론이 구분됩니다.
- 탐색 횟수·파일 수·토큰·비용에 상한이 있고, 접속 출처별 요청 제한과 서비스 일일 비용 상한이 있습니다.

## 구성

| 패키지 | 내용 |
|---|---|
| `frontend/` | React 19 · Vite · Tailwind CSS v4 화면 |
| `backend/` | Fastify API, 인프로세스 분석 워커, GitHub 수집, Gemini 어댑터, Supabase Postgres |
| `shared/` | 프론트·백엔드 공용 스키마(zod), GitHub URL 파서, 섹션 카탈로그 |
| `specs/001-repo-manual-generator/` | 명세·계획·작업 목록·검증 기록 (Spec Kit) |

## 빠른 시작

Node.js 24, Supabase 프로젝트, GitHub Fine-grained 토큰(공개 저장소 읽기), Gemini API 키가 필요합니다. 발급 방법은 [quickstart 1장](specs/001-repo-manual-generator/quickstart.md)에 있습니다.

```bash
npm install
cp .env.example .env        # 값을 채운다 (Windows: Copy-Item .env.example .env)
npm run db:migrate          # 스키마 · pgvector · RLS
npm run dev                 # http://localhost:5173 (API는 8787)
```

## 자주 쓰는 명령

| 명령 | 설명 |
|---|---|
| `npm test` | 전체 테스트 (외부 서비스 불필요, DB는 PGlite) |
| `npm run test:db` | 실제 Postgres 동시성 테스트 (`TEST_DATABASE_URL` 필요) |
| `npm run lint` / `npm run typecheck` | 린트 · 타입 검사 |
| `npm run build` → `npm start` | 프로덕션 빌드 후 단일 Node 서비스로 실행 (API + 워커 + 화면) |
| `npm run dev:ingest -- <URL>` | GitHub 수집만 확인 (AI 미사용) |
| `npm run dev:analyze -- <URL> --level beginner --purpose setup` | 분석 한 건을 끝까지 실행하고 요약 출력 |
| `npm run llm:ping` | Gemini 연결 확인 |
| `npm run eval` | 평가 저장소 분석 후 지표 리포트 생성 (비용 발생) |
| `npm run blind-kit -- <분석 ID…>` | 수준별 블라인드 판별 키트 생성 |

자세한 검증 절차는 [quickstart.md](specs/001-repo-manual-generator/quickstart.md), 설계는 [plan.md](specs/001-repo-manual-generator/plan.md)를 보세요.
