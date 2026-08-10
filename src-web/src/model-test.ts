import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

export type ModelTestInput = {
  name: string;
  baseUrl: string;
  apiKey: string;
  responsive?: boolean;
};

function resolveBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/responses$/i, "");
}

export async function testModelConnection(model: ModelTestInput) {
  const url = new URL(model.baseUrl);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("接口地址必须是合法的 http 或 https URL");
  }

  const provider = createOpenAI({
    apiKey: model.apiKey,
    baseURL: resolveBaseUrl(url.toString()),
  });
  const languageModel = model.responsive
    ? provider.responses(model.name.trim())
    : provider.chat(model.name.trim());
  const startedAt = Date.now();

  await generateText({
    model: languageModel,
    prompt: "Reply with OK only.",
    maxRetries: 0,
    maxOutputTokens: 1,
    temperature: 0,
    abortSignal: AbortSignal.timeout(15_000),
  });

  return { durationMs: Date.now() - startedAt };
}
