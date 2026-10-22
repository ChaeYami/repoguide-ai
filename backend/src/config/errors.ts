import type { z } from "zod";

export interface EnvIssue {
  name: string;
  problem: string;
}

/** 환경 변수 검증 실패. 메시지에는 변수 이름과 문제만 담고 값은 담지 않는다. */
export class EnvError extends Error {
  constructor(readonly issues: EnvIssue[]) {
    super(
      [
        "환경 변수 설정을 확인해 주세요:",
        ...issues.map((issue) => `  - ${issue.name}: ${issue.problem}`),
        "루트의 .env.example을 .env로 복사해 값을 채우세요 (specs/001-repo-manual-generator/quickstart.md 1·2장).",
      ].join("\n"),
    );
    this.name = "EnvError";
  }
}

export function issuesFromZod(error: z.ZodError): EnvIssue[] {
  return error.issues.map((issue) => ({
    name: String(issue.path[0] ?? "(unknown)"),
    problem: issue.code === "invalid_type" ? "값의 형식이 올바르지 않습니다" : issue.message,
  }));
}
