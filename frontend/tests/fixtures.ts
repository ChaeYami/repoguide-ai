import type { AnalysisDetail, Manual } from "@repoguide/shared";

export const SHA = "0123456789abcdef0123456789abcdef01234567";
export const ID = "11111111-1111-4111-8111-111111111111";

export function detail(overrides: Partial<AnalysisDetail> = {}): AnalysisDetail {
  const now = new Date().toISOString();
  return {
    id: ID,
    repo: { owner: "acme", name: "demo", ref: "main", commitSha: SHA, subpath: null, htmlUrl: "https://github.com/acme/demo" },
    level: "beginner",
    purpose: "setup",
    status: "running",
    createdAt: now,
    finishedAt: null,
    stage: "reading_files",
    progress: { round: 1, maxRounds: 3, filesRead: 5, filesPlanned: 7, activity: "llm_deciding", updatedAt: now },
    queuePosition: null,
    failure: null,
    partialReasons: [],
    hasManual: false,
    expiresAt: now,
    parentId: null,
    regenerationMode: null,
    versions: [],
    ...overrides,
  };
}

const url = (path: string, s: number, e: number) => `https://github.com/acme/demo/blob/${SHA}/${path}#L${s}-L${e}`;

export function manual(overrides: Partial<Manual> = {}): Manual {
  return {
    analysisId: ID,
    language: "ko",
    level: "beginner",
    purpose: "setup",
    repo: { owner: "acme", name: "demo", ref: "main", commitSha: SHA, htmlUrl: "https://github.com/acme/demo" },
    title: "demo 설치 매뉴얼",
    overview: "Node.js 웹 서버를 설치하고 실행하는 방법",
    sections: [
      {
        id: "environment",
        title: "실행 환경",
        status: "found",
        blocks: [
          { id: "environment.1", type: "text", markdown: "Node.js 24가 필요합니다.", kind: "fact", downgraded: false, evidence: [{ path: "Dockerfile", startLine: 1, endLine: 1, url: url("Dockerfile", 1, 1) }] },
          { id: "environment.2", type: "text", markdown: "보통 macOS에서도 됩니다. <script>alert(1)</script> [위험](javascript:alert(1))", kind: "inference", downgraded: true, evidence: [] },
        ],
      },
      { id: "dependencies", title: "의존성", status: "not_found", blocks: [] },
      {
        id: "install_steps",
        title: "설치 절차",
        status: "found",
        blocks: [
          {
            id: "install_steps.1", type: "step", stepNo: 1, markdown: "의존성을 설치합니다.", kind: "fact", downgraded: false,
            command: "npm install", expectedResult: "added 120 packages", troubleshooting: "Node 버전을 확인하세요",
            evidence: [{ path: "package.json", startLine: 2, endLine: 9, url: url("package.json", 2, 9) }],
          },
        ],
      },
      { id: "configuration", title: "설정 파일", status: "not_found", blocks: [] },
      { id: "run_commands", title: "실행 명령", status: "not_found", blocks: [] },
      { id: "verification", title: "정상 동작 확인", status: "not_found", blocks: [] },
    ],
    levelExtras: { level: "beginner", glossary: [{ term: "npm", explanation: "Node.js 패키지 관리자" }], prerequisites: [{ topic: "터미널", explanation: "명령을 입력하는 창" }] },
    limitations: ["테스트 폴더는 읽지 않았습니다."],
    generatedAt: new Date().toISOString(),
    model: "gemini-3.8-flash",
    promptVersion: "test",
    ...overrides,
  };
}
