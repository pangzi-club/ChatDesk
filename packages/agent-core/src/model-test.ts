import { generateText } from "ai";
import { createConfiguredLanguageModel, normalizeModelApiBaseUrl } from "./model-adaptor.ts";

export type ModelTestInput = {
  name: string;
  baseUrl: string;
  apiKey: string;
  responsive?: boolean;
};

export type ProviderModel = {
  id: string;
  contextLength?: number;
  outputContext?: number;
  supportsTools?: boolean;
  supportsImageIn?: boolean;
  supportsVideoIn?: boolean;
  supportsReasoning?: boolean;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cacheReadPricePerMillion?: number;
  cacheWritePricePerMillion?: number;
};

function positiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function pricePerMillion(value: unknown) {
  const price = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(price) && price >= 0 ? price * 1_000_000 : undefined;
}

function validateModelEndpoint(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("接口地址必须是合法的 http 或 https URL");
  }
  return normalizeModelApiBaseUrl(url.toString());
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
    const architecture =
      value.architecture && typeof value.architecture === "object"
        ? (value.architecture as Record<string, unknown>)
        : undefined;
    const inputModalities = Array.isArray(architecture?.input_modalities)
      ? architecture.input_modalities
      : [];
    const supportedParameters = Array.isArray(value.supported_parameters)
      ? value.supported_parameters
      : [];
    const topProvider =
      value.top_provider && typeof value.top_provider === "object"
        ? (value.top_provider as Record<string, unknown>)
        : undefined;
    const pricing =
      value.pricing && typeof value.pricing === "object"
        ? (value.pricing as Record<string, unknown>)
        : undefined;
    return [
      {
        id: value.id,
        contextLength: positiveNumber(value.context_length),
        outputContext: positiveNumber(topProvider?.max_completion_tokens),
        supportsTools:
          value.supports_tools === true ||
          supportedParameters.includes("tools") ||
          supportedParameters.includes("tool_choice"),
        supportsImageIn: value.supports_image_in === true || inputModalities.includes("image"),
        supportsVideoIn: value.supports_video_in === true || inputModalities.includes("video"),
        supportsReasoning:
          value.supports_reasoning === true ||
          supportedParameters.includes("reasoning") ||
          supportedParameters.includes("include_reasoning"),
        inputPricePerMillion: pricePerMillion(pricing?.prompt),
        outputPricePerMillion: pricePerMillion(pricing?.completion),
        cacheReadPricePerMillion: pricePerMillion(pricing?.input_cache_read),
        cacheWritePricePerMillion: pricePerMillion(pricing?.input_cache_write),
      },
    ];
  });
}

export async function testModelConnection(model: ModelTestInput) {
  const url = new URL(model.baseUrl);
  const startedAt = Date.now();

  await generateText({
    model: createConfiguredLanguageModel({
      ...model,
      baseUrl: validateModelEndpoint(url.toString()),
    }),
    prompt: "Reply with OK only.",
    maxRetries: 0,
    maxOutputTokens: 1,
    temperature: 0,
    abortSignal: AbortSignal.timeout(15_000),
  });

  return { durationMs: Date.now() - startedAt };
}
