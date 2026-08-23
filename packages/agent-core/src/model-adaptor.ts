import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { installAiSdkWarningFilter } from "./ai-sdk-warnings.ts";
import { createKimiFetch } from "./kimi.ts";
import { createMiniMaxFetch, isMiniMaxModel } from "./minimax.ts";
import type { ServerModelConfig } from "./protocol.ts";

installAiSdkWarningFilter();

export type ModelAdaptorIdentity = {
  name?: string;
  provider?: string;
  baseUrl?: string;
  responsive?: boolean;
};

type AdaptedLanguageModel = Parameters<typeof wrapLanguageModel>[0]["model"];

function modelIdentity(model: ModelAdaptorIdentity) {
  return `${model.provider ?? ""} ${model.baseUrl ?? ""} ${model.name ?? ""}`.toLowerCase();
}

export function isDeepSeekModel(model: ModelAdaptorIdentity) {
  return modelIdentity(model).includes("deepseek");
}

function hostnameFromBaseUrl(value?: string) {
  if (!value?.trim()) return "";
  try {
    return new URL(normalizeModelApiBaseUrl(value)).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Official OpenAI Responses hosts persist items, so `store: true` and
 * `item_reference` are valid. Azure OpenAI uses the same store semantics.
 */
export function isOpenAIResponsesStoreEnabled(model: ModelAdaptorIdentity) {
  const host = hostnameFromBaseUrl(model.baseUrl);
  return (
    host === "api.openai.com" || host === "openai.azure.com" || host.endsWith(".openai.azure.com")
  );
}

/**
 * Compatible Responses APIs are treated as stateless: they typically ignore
 * `store`, `previous_response_id`, `conversation`, and `item_reference`.
 */
export function usesStatelessResponsesApi(model: ModelAdaptorIdentity) {
  return !isOpenAIResponsesStoreEnabled(model);
}

export function supportsRequiredToolChoice(model: ModelAdaptorIdentity) {
  if (!model.responsive) return true;
  return !isDeepSeekModel(model);
}

export function normalizeModelApiBaseUrl(value: string) {
  return value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/responses$/i, "");
}

function openaiProviderOptions(value: unknown) {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export function applyStatelessResponsesProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
) {
  return {
    ...providerOptions,
    openai: {
      ...openaiProviderOptions(providerOptions?.openai),
      store: false,
    },
  };
}

export function statelessResponsesMiddleware(): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => ({
      ...params,
      providerOptions: applyStatelessResponsesProviderOptions(
        params.providerOptions as Record<string, unknown> | undefined,
      ),
    }),
  };
}

export function applyModelAdaptor(
  model: ModelAdaptorIdentity,
  languageModel: AdaptedLanguageModel,
): LanguageModel {
  if (!model.responsive || !usesStatelessResponsesApi(model)) return languageModel;
  return wrapLanguageModel({
    model: languageModel,
    middleware: statelessResponsesMiddleware(),
  });
}

export function createConfiguredLanguageModel(
  model: Pick<ServerModelConfig, "name" | "provider" | "baseUrl" | "apiKey" | "responsive">,
) {
  const provider = createOpenAI({
    apiKey: model.apiKey,
    baseURL: normalizeModelApiBaseUrl(model.baseUrl),
    fetch: isMiniMaxModel(model) ? createMiniMaxFetch(model) : createKimiFetch(model),
  });
  const languageModel = model.responsive
    ? provider.responses(model.name.trim())
    : provider.chat(model.name.trim());
  return applyModelAdaptor(model, languageModel);
}
