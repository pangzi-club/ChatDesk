import { createOpenAI } from "@ai-sdk/openai";
import { type LanguageModel, type LanguageModelMiddleware, wrapLanguageModel } from "ai";
import { createKimiFetch } from "./kimi.ts";
import { createMiniMaxFetch, isMiniMaxModel } from "./minimax.ts";
import type { ServerModelConfig } from "./protocol.ts";

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

/**
 * Providers whose Responses API is stateless: they ignore `store`,
 * `previous_response_id`, `conversation`, and `item_reference`.
 */
export function usesStatelessResponsesApi(model: ModelAdaptorIdentity) {
  return isDeepSeekModel(model);
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
