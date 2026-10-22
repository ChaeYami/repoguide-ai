import { normalizePath } from "./request-validator.js";

// 근거 검증 (research R8 규칙 1·2, FR-025). 범위를 고쳐 쓰지 않고, 맞지 않는 근거는 버린다.

export interface RawEvidence {
  path: string;
  startLine: number;
  endLine: number;
}

export interface EvidenceCheck {
  kept: RawEvidence[];
  dropped: number;
}

/**
 * @param sources 이 실행의 작업 집합 중 원문이 있는 파일의 줄 수 (경로 → line_count)
 */
export function validateEvidence(evidence: readonly RawEvidence[], sources: ReadonlyMap<string, number>): EvidenceCheck {
  const kept: RawEvidence[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const item of evidence) {
    const path = normalizePath(item.path);
    const lineCount = sources.get(path);
    const inRange =
      lineCount !== undefined &&
      Number.isInteger(item.startLine) &&
      Number.isInteger(item.endLine) &&
      item.startLine >= 1 &&
      item.startLine <= item.endLine &&
      item.endLine <= lineCount;
    const key = `${path}:${item.startLine}-${item.endLine}`;
    if (!inRange) {
      dropped += 1;
    } else if (!seen.has(key)) {
      seen.add(key);
      kept.push({ path, startLine: item.startLine, endLine: item.endLine });
    }
  }
  return { kept, dropped };
}
