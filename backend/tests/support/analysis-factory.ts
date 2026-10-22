import { parseLimits } from "../../src/config/limits.js";
import type { NewAnalysis } from "../../src/db/repositories/analyses.js";

export function newAnalysisInput(overrides: Partial<NewAnalysis> = {}): NewAnalysis {
  return {
    repoOwner: "acme",
    repoName: "app",
    requestedRef: null,
    subpath: null,
    level: "beginner",
    purpose: "setup",
    limits: parseLimits({}),
    promptVersion: "test",
    clientKeyHash: "client-hash",
    expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
    ...overrides,
  };
}
