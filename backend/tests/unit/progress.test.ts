import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressReporter } from "../../src/pipeline/progress.js";

const initial = { round: 0, maxRounds: 3, filesRead: 0, filesPlanned: 0, activity: null, updatedAt: "2026-10-22T00:00:00.000Z" };

describe("ProgressReporter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("refreshes updatedAt at least every 10 seconds during a slow LLM call (SC-002)", async () => {
    const writes: { at: number; activity: string | null; stage?: string }[] = [];
    const reporter = new ProgressReporter(
      { updateProgress: async (_id, update) => void writes.push({ at: Date.now(), activity: update.progress.activity, stage: update.stage }) },
      "a1",
      initial,
    );

    let finish!: () => void;
    const slowCall = new Promise<string>((resolve) => (finish = () => resolve("done")));
    const running = reporter.withActivity("llm_writing", () => slowCall);

    await vi.advanceTimersByTimeAsync(45_000);
    finish();
    await expect(running).resolves.toBe("done");

    expect(writes[0]!.activity).toBe("llm_writing");
    expect(writes.at(-1)!.activity).toBeNull();
    const gaps = writes.slice(1).map((w, i) => w.at - writes[i]!.at);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(10_000);
    expect(writes.length).toBeGreaterThanOrEqual(5);
  });

  it("stops the heartbeat when the task fails", async () => {
    let count = 0;
    const reporter = new ProgressReporter({ updateProgress: async () => void (count += 1) }, "a1", initial);
    await expect(reporter.withActivity("reading_files", async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
    const after = count;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(count).toBe(after);
  });

  it("writes stage changes together with progress", async () => {
    const stages: (string | undefined)[] = [];
    const reporter = new ProgressReporter({ updateProgress: async (_id, update) => void stages.push(update.stage) }, "a1", initial);
    await reporter.update({ stage: "selecting_files", round: 1 });
    expect(stages).toEqual(["selecting_files"]);
    expect(reporter.progress.round).toBe(1);
  });
});
