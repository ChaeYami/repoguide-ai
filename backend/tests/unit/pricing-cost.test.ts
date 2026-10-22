import { describe, expect, it } from "vitest";
import { priceFor, UnknownModelPriceError } from "../../src/config/pricing.js";
import { actualCost, estimateCall, estimateTokens } from "../../src/llm/cost.js";

describe("priceFor", () => {
  it("uses the current Flash price until the end of 2026", () => {
    expect(priceFor("gemini-3.8-flash", new Date("2026-12-31T23:59:59Z"))).toEqual({ inputPerMTok: 0.75, outputPerMTok: 3.75 });
  });

  it("switches to the doubled Flash price on 2027-01-01", () => {
    expect(priceFor("gemini-3.8-flash", new Date("2027-01-01T00:00:00Z"))).toEqual({ inputPerMTok: 1.5, outputPerMTok: 7.5 });
  });

  it("keeps the Flash-Lite price unchanged", () => {
    expect(priceFor("gemini-3.5-flash-lite", new Date("2027-06-01T00:00:00Z"))).toEqual({ inputPerMTok: 0.3, outputPerMTok: 2.5 });
  });

  it("refuses unknown models so the cost cap is never silently skipped", () => {
    expect(() => priceFor("gemini-9-ultra")).toThrow(UnknownModelPriceError);
  });
});

describe("cost estimation", () => {
  it("counts ASCII at 3 chars per token and non-ASCII at 1 char per token", () => {
    expect(estimateTokens("abcdef")).toBe(2);
    expect(estimateTokens("한국어")).toBe(3);
    expect(estimateTokens("ab한")).toBe(2);
  });

  it("estimates with the output cap plus a thinking allowance", () => {
    const estimate = estimateCall({ inputPerMTok: 1, outputPerMTok: 10 }, { text: "x".repeat(3_000), maxOutputTokens: 1_000, thinkingLevel: "low" });
    expect(estimate).toEqual({ inputTokens: 1_000, outputTokens: 3_048, costUsd: (1_000 * 1 + 3_048 * 10) / 1_000_000 });
  });

  it("charges thought tokens at the output price", () => {
    expect(actualCost({ inputPerMTok: 0.75, outputPerMTok: 3.75 }, { inputTokens: 100_000, outputTokens: 8_000, thoughtTokens: 2_000 })).toBeCloseTo(0.075 + 0.0375, 10);
  });
});
