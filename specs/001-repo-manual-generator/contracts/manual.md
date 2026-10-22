# Manual Document Contract

`GET /api/analyses/{id}/manual` 응답이자 `manuals.document`에 저장되는 구조다. 스키마의 원본은
`shared/src/manual.ts`의 zod 정의다. 백엔드는 LLM Write 출력([llm-io.md](./llm-io.md))을 검증하고
조립해 이 문서를 만든다. 프론트엔드는 이 구조를 컴포넌트로 렌더링한다.

## 구조

```ts
type Manual = {
  analysisId: string;
  language: "ko";
  level: Level;
  purpose: Purpose;
  repo: { owner: string; name: string; ref: string; commitSha: string; htmlUrl: string };
  title: string;
  overview: string;                       // 2~4문장 요약 (markdown)
  sections: ManualSection[];              // 목적별 필수 섹션 전체, 카탈로그 순서 (FR-020)
  levelExtras: LevelExtras;               // 수준별 추가 요소 (FR-021)
  limitations: string[];                  // 분석 범위 한계 안내. 코드 고정 문구(README 외 파일 없음, 트리 잘림, 원문 축소 등)가 앞, LLM 문구가 뒤
  generatedAt: string;
  model: string;
  promptVersion: string;
};

type ManualSection = {
  id: SectionId;
  title: string;                          // 코드 카탈로그의 고정 한국어 제목 (LLM 생성 아님)
  status: "found" | "partial" | "not_found";
  blocks: ManualBlock[];                  // not_found면 빈 배열 → 화면에 "저장소에서 확인되지 않음"
};

type ManualBlock = {
  id: string;                             // 섹션 내 고유 (예: "setup.install_steps.3")
  type: "text" | "step";
  markdown: string;                       // 원시 HTML 미렌더링 (R9)
  kind: "fact" | "inference";             // 화면 배지: 확인됨 / 추론 (FR-026)
  downgraded: boolean;                    // 근거 검증 실패로 fact → inference 강등됨 (R8)
  evidence: Evidence[];                   // kind=fact면 1개 이상 (검증 후 불변식)
  // type=step 전용 (선택)
  stepNo?: number;
  command?: string;                       // 원문 유지 (FR-023)
  expectedResult?: string;                // 정상일 때 보이는 결과 (입문자 필수)
  troubleshooting?: string;               // 흔한 실패 대처 (입문자 필수)
};

type Evidence = {
  path: string;
  startLine: number;
  endLine: number;
  url: string;                            // https://github.com/{o}/{r}/blob/{commitSha}/{path}#L{s}-L{e}
};

type LevelExtras =
  | { level: "beginner"; glossary: { term: string; explanation: string }[];
      prerequisites: { topic: string; explanation: string }[] }
  | { level: "vibe_coder"; contextSummary: string;              // AI 도구에 붙여넣을 프로젝트 맥락
      relatedFiles: { path: string; why: string; url: string }[];
      promptExamples: { title: string; prompt: string }[];
      checklist: string[] }                                    // 변경 후 검증 체크리스트
  | { level: "developer" };                                    // 추가 요소 없음 (본문 상세화)
```

## 섹션 카탈로그 (FR-020)

`id`와 `title`은 코드 상수로 정의하고, LLM은 `id`로만 섹션을 지정한다.

| purpose | SectionId (순서대로) | 제목 |
|---------|----------------------|------|
| `understand` | `role`, `core_features`, `components`, `architecture`, `execution_flow` | 프로젝트의 역할 / 핵심 기능 / 주요 구성 요소 / 아키텍처 / 실행 흐름 |
| `setup` | `environment`, `dependencies`, `install_steps`, `configuration`, `run_commands`, `verification` | 실행 환경 / 의존성 / 설치 절차 / 설정 파일 / 실행 명령 / 정상 동작 확인 |
| `modify` | `entry_points`, `related_files`, `data_flow`, `change_points`, `extension_directions`, `change_verification` | 주요 진입점 / 수정 관련 파일 / 데이터 흐름 / 변경 지점 / 확장 방향 / 변경 검증 방법 |

## 불변식 (조립 후 코드가 보장, 테스트 대상)

1. `sections`는 해당 목적의 카탈로그 섹션을 **빠짐없이, 카탈로그 순서대로** 포함한다.
2. 모든 `evidence[].path`는 해당 분석의 `explored_files`에 존재한다(FR-025).
3. 모든 `evidence`는 `1 ≤ startLine ≤ endLine ≤ snapshot_files.line_count`를 만족한다.
4. `kind = "fact"`인 블록은 `evidence`가 1개 이상이다. 근거가 없으면 `inference`이고
   `downgraded=true`일 수 있다.
5. `levelExtras.level`은 `level`과 같다.
6. `level = "beginner"`이고 `type = "step"`인 블록에 `expectedResult`나 `troubleshooting`이 빠지면
   검증 경고로 기록한다(`stats`). 블록은 유지한다.
7. `markdown`, `command` 등 모든 문자열 필드는 한국어 본문이며, 코드·경로·명령은 원문을 유지한다.

## 화면 표시 규칙 (US2)

- `kind=fact`는 "확인됨" 배지, `inference`는 "추론" 배지로 표시한다. `downgraded`는 "추론(근거
  확인 실패)" 툴팁을 단다.
- `evidence`는 `path:L{s}-L{e}` 칩으로 표시하고, 누르면 `url`을 새 탭으로 연다.
- `status=not_found` 섹션은 "저장소에서 확인되지 않음" 안내 블록으로 표시한다. `partial` 섹션에는
  "일부만 확인됨" 표시를 붙인다.
- `limitations`가 있으면 매뉴얼 상단 배너에 표시한다. 분석 상태가 `partial`이면 배너가 항상 나타난다.
