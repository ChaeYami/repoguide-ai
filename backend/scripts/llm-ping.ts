// npm run llm:ping — 실제 Gemini API로 두 기본 모델의 구조화 출력과 사용량을 확인한다 (연결 지점 ③).
import { z } from "zod";
import { EnvError, loadConfig } from "../src/config/env.js";
import { priceFor } from "../src/config/pricing.js";
import { LlmError } from "../src/llm/client.js";
import { actualCost } from "../src/llm/cost.js";
import { GeminiClient } from "../src/llm/gemini-client.js";

const PingSchema = z.object({ ok: z.boolean(), language: z.string(), sum: z.number().int() });

async function main() {
  const { env } = loadConfig({ require: ["GEMINI_API_KEY"] });
  const client = new GeminiClient({ apiKey: env.GEMINI_API_KEY! });
  let failed = false;

  for (const [role, model] of [
    ["decide", env.GEMINI_MODEL_DECIDE],
    ["write", env.GEMINI_MODEL_WRITE],
  ] as const) {
    const started = Date.now();
    try {
      const result = await client.generateStructured({
        role,
        model,
        systemInstruction: "You are a health check. Reply only with JSON that follows the schema.",
        input: 'Set ok to true, language to "ko", and sum to 2+3.',
        schema: PingSchema,
        maxOutputTokens: 256,
        // gemini-3.8-flash는 minimal을 지원하지 않는다(HTTP 400). 파이프라인과 같은 low를 쓴다.
        thinkingLevel: "low",
      });
      const cost = actualCost(priceFor(model), result.usage);
      console.log(
        `✔ ${role.padEnd(6)} ${model}: ${JSON.stringify(result.data)} | 입력 ${result.usage.inputTokens}${result.usage.usageEstimated ? "(추정)" : ""} · 출력 ${result.usage.outputTokens} · 사고 ${result.usage.thoughtTokens} 토큰 | $${cost.toFixed(6)} | ${Date.now() - started}ms`,
      );
    } catch (error) {
      failed = true;
      console.error(`✘ ${role.padEnd(6)} ${model}: ${error instanceof LlmError ? error.message : error}`);
    }
  }
  if (failed) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof EnvError ? error.message : error);
  process.exitCode = 1;
});
