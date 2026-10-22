// 모델별 단가 (USD / 1M 토큰, research R4). 적용 시작일이 있어 가격 변경이 자동 반영된다.
// 출력 단가는 사고(thinking) 토큰에도 적용된다.

export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
}

interface PriceEntry extends ModelPrice {
  model: string;
  /** 이 날짜(UTC 00:00)부터 적용 */
  from: string;
}

export const PRICE_TABLE: readonly PriceEntry[] = [
  { model: "gemini-3.5-flash-lite", from: "2000-01-01", inputPerMTok: 0.3, outputPerMTok: 2.5 },
  { model: "gemini-3.8-flash", from: "2000-01-01", inputPerMTok: 0.75, outputPerMTok: 3.75 },
  { model: "gemini-3.8-flash", from: "2027-01-01", inputPerMTok: 1.5, outputPerMTok: 7.5 },
];

export class UnknownModelPriceError extends Error {
  constructor(model: string) {
    const known = [...new Set(PRICE_TABLE.map((entry) => entry.model))].join(", ");
    super(`가격표에 없는 모델입니다: ${model}. 비용 한도를 강제할 수 없으므로 backend/src/config/pricing.ts에 단가를 추가하세요 (등록된 모델: ${known})`);
    this.name = "UnknownModelPriceError";
  }
}

export function priceFor(model: string, at: Date = new Date(), table: readonly PriceEntry[] = PRICE_TABLE): ModelPrice {
  const applicable = table
    .filter((entry) => entry.model === model && new Date(`${entry.from}T00:00:00Z`).getTime() <= at.getTime())
    .sort((a, b) => b.from.localeCompare(a.from))[0];
  if (!applicable) throw new UnknownModelPriceError(model);
  return { inputPerMTok: applicable.inputPerMTok, outputPerMTok: applicable.outputPerMTok };
}
