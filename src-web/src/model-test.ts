import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { createKimiFetch } from "./kimi.ts";

export type ModelTestInput = {
  name: string;
  baseUrl: string;
  apiKey: string;
  responsive?: boolean;
};

export type ProviderModel = {
  id: string;
  contextLength?: number;
  supportsImageIn?: boolean;
  supportsVideoIn?: boolean;
  supportsReasoning?: boolean;
};

function resolveBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/responses$/i, "");
}

function validateModelEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("接口地址必须是合法的 http 或 https URL");
  }
  return resolveBaseUrl(url.toString());
}

export async function listProviderModels(input: Pick<ModelTestInput, "baseUrl" | "apiKey">) {
  const endpoint = `${validateModelEndpoint(input.baseUrl)}/models`;
  const response = await fetch(endpoint, {
    headers: { Accept: "application/json", Authorization: `Bearer ${input.apiKey}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    let message = `模型列表请求失败（${response.status}）`;
    try {
      const payload = (await response.json()) as { error?: { message?: unknown } | string };
      const providerMessage =
        typeof payload.error === "string" ? payload.error : payload.error?.message;
      if (typeof providerMessage === "string" && providerMessage) message = providerMessage;
    } catch {
      // Keep the status-based error when the provider returns malformed JSON.
    }
    throw new Error(message);
  }
  const payload = (await response.json()) as { data?: unknown };
  if (!Array.isArray(payload.data)) return [];
  return payload.data.flatMap((item): ProviderModel[] => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.id !== "string" || !value.id.trim()) return [];
    return [
      {
        id: value.id,
        contextLength:
          typeof value.context_length === "number" && value.context_length > 0
            ? value.context_length
            : undefined,
        supportsImageIn: value.supports_image_in === true,
        supportsVideoIn: value.supports_video_in === true,
        supportsReasoning: value.supports_reasoning === true,
      },
    ];
  });
}

export async function testModelConnection(model: ModelTestInput) {
  const url = new URL(model.baseUrl);

  const provider = createOpenAI({
    apiKey: model.apiKey,
    baseURL: validateModelEndpoint(url.toString()),
    fetch: createKimiFetch(model),
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
