import type { CoverageStatus, RequestRejectReason } from "@repoguide/shared";

// JSONB 컬럼에 저장하는 구조 (data-model.md 각 테이블 설명).

/** 필터를 통과한 읽기 후보 파일 (repo_snapshots.candidates) */
export interface Candidate {
  path: string;
  size: number;
  blobSha: string;
}

/** Decide 요청과 코드 검증 결과 (exploration_rounds.requests) */
export interface RequestRecord {
  path: string;
  reason: string;
  accepted: boolean;
  rejectReason: RequestRejectReason | null;
}

export interface CoverageEntry {
  sectionId: string;
  status: CoverageStatus;
  note: string;
}

export interface FileNote {
  path: string;
  summary: string;
  facts: { text: string; startLine: number; endLine: number }[];
}

export interface ManualStats {
  blocks: number;
  facts: number;
  inferences: number;
  evidenceKept: number;
  evidenceDropped: number;
  downgraded: number;
  sectionsNotFound: number;
  /** 입문자용 step 블록에서 expectedResult나 troubleshooting이 빠진 수 (contracts/manual.md 불변식 6) */
  stepWarnings: number;
}
