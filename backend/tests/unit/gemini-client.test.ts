import { describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmError } from "../../src/llm/client.js";
import { GeminiClient, type InteractionsApi, retryDelayMs } from "../../src/llm/gemini-client.js";

const Schema = z.object({ answer: z.string(), count: z.number().int() });

function request(overrides: Partial<Parameters<GeminiClient["generateStructured"]>[0]> = {}) {
  return {
    role: "decide" as const,
    model: "gemini-3.5-flash-lite",
    systemInstruction: "시스템 지시",
    input: "입력",
    schema: Schema,
    maxOutputTokens: 512,
    thinkingLevel: "low" as const,
    ...overrides,
  };
}

type Reply = { output_text?: string; usage?: Record<string, number> } | { throw: { status?: number; message?: string } };

function fakeApi(replies: Reply[]) {
  const params: Record<string, unknown>[] = [];
  const api: InteractionsApi = {
    async create(p) {
      params.push(p);
      const reply = replies.shift();
      if (!reply) throw new Error("no more replies");
      if ("throw" in reply) throw Object.assign(new Error("api error"), reply.throw);
      return reply;
    },
  };
  const sleeps: number[] = [];
  const client = new GeminiClient({ api, sleep: async (ms) => void sleeps.push(ms) });
  return { client, params, sleeps };
}

const ok = (data: unknown, usage = { total_input_tokens: 120, total_output_tokens: 30, total_thought_tokens: 10 }) => ({
  output_text: JSON.stringify(data),
  usage,
});

describe("GeminiClient.generateStructured", () => {
  it("sends a structured-output request with store:false and no temperature", async () => {
    const { client, params } = fakeApi([ok({ answer: "네", count: 2 })]);
    const result = await client.generateStructured(request());
    expect(result).toEqual({
      data: { answer: "네", count: 2 },
      usage: { inputTokens: 120, outputTokens: 30, thoughtTokens: 10, usageEstimated: false },
      attempts: 1,
    });
    const sent = params[0]!;
    expect(sent).toMatchObject({
      model: "gemini-3.5-flash-lite",
      system_instruction: "시스템 지시",
      input: "입력",
      store: false,
      generation_config: { max_output_tokens: 512, thinking_level: "low" },
      response_format: { type: "text", mime_type: "application/json" },
    });
    expect(sent).not.toHaveProperty("temperature");
    expect(sent.generation_config).not.toHaveProperty("temperature");
    const schema = (sent.response_format as { schema: Record<string, unknown> }).schema;
    expect(schema).not.toHaveProperty("$schema");
    expect(schema).toMatchObject({ type: "object", required: ["answer", "count"] });
  });

  it("retries once with the validation problem when the output breaks the schema", async () => {
    const { client, params } = fakeApi([ok({ answer: "네" }), ok({ answer: "네", count: 1 })]);
    const result = await client.generateStructured(request());
    expect(result.attempts).toBe(2);
    expect(result.usage.inputTokens).toBe(240);
    expect(String(params[1]!.input)).toContain("count");
  });

  it("fails with llm_invalid_output after the second bad answer and reports usage spent", async () => {
    const { client } = fakeApi([{ output_text: "not json", usage: { total_input_tokens: 50 } }, ok({ wrong: true })]);
    const error = await client.generateStructured(request()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).code).toBe("llm_invalid_output");
    expect((error as LlmError).usage.inputTokens).toBe(170);
  });

  it("backs off on 429 and 5xx up to three times", async () => {
    const { client, sleeps } = fakeApi([{ throw: { status: 429 } }, { throw: { status: 503 } }, ok({ answer: "a", count: 0 })]);
    await expect(client.generateStructured(request())).resolves.toMatchObject({ attempts: 3 });
    expect(sleeps).toEqual([5_000, 15_000]);
  });

  it("maps exhausted rate limits to llm_rate_limited and outages to llm_unavailable", async () => {
    const limited = fakeApi(Array.from({ length: 4 }, () => ({ throw: { status: 429 } })));
    await expect(limited.client.generateStructured(request())).rejects.toMatchObject({ code: "llm_rate_limited" });
    expect(limited.sleeps).toHaveLength(3);

    const down = fakeApi(Array.from({ length: 4 }, () => ({ throw: {} })));
    await expect(down.client.generateStructured(request())).rejects.toMatchObject({ code: "llm_unavailable" });
  });

  it("does not retry client errors such as an invalid key", async () => {
    const { client, sleeps } = fakeApi([{ throw: { status: 403 } }]);
    await expect(client.generateStructured(request())).rejects.toMatchObject({ code: "llm_unavailable" });
    expect(sleeps).toEqual([]);
  });

  it("estimates input tokens when the service reports zero", async () => {
    const { client } = fakeApi([ok({ answer: "a", count: 0 }, { total_input_tokens: 0, total_output_tokens: 5, total_thought_tokens: 0 })]);
    const { usage } = await client.generateStructured(request({ systemInstruction: "abc", input: "한국어" }));
    expect(usage).toEqual({ inputTokens: 1 + 3, outputTokens: 5, thoughtTokens: 0, usageEstimated: true });
  });

  it("waits as long as the 429 response's RetryInfo asks (per-minute limits), capped at 90 seconds", async () => {
    const quota = (seconds: string) => ({
      throw: { status: 429, message: `{"error":{"code":429,"status":"RESOURCE_EXHAUSTED","details":[{"@type":"type.googleapis.com/google.rpc.RetryInfo","retryDelay":"${seconds}s"}]}}` },
    });
    const { client, sleeps } = fakeApi([quota("41"), quota("300"), ok({ answer: "a", count: 0 })]);
    await expect(client.generateStructured(request())).resolves.toMatchObject({ attempts: 3 });
    expect(sleeps).toEqual([42_000, 90_000]);
  });
});

describe("retryDelayMs", () => {
  it.each([
    ['{"retryDelay":"41s"}', 41_000],
    ['retryDelay\\":\\"7.5s', 7_500],
    ["no hint", null],
  ])("%s → %s", (message, expected) => {
    expect(retryDelayMs(new Error(message))).toBe(expected);
  });
});

