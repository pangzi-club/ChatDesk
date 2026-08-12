import type { ModelConfig } from "@chatdesk/shared";
import { loadChatServerConfig, saveChatServerConfig } from "@/lib/chat-server";

export const MODELS_STORE_KEY = "models";

const KNOWN_MODEL_CONTEXT_WINDOWS: Record<string, number> = {
  "deepseek-v4-flash": 1_000_000,
  "deepseek-v4-pro": 1_000_000,
  "kimi-k3": 1_000_000,
  "kimi-k2.7-code": 256_000,
  "kimi-k2.7-code-highspeed": 256_000,
  "kimi-k2.6": 256_000,
  "kimi-k2.5": 256_000,
  "minimax-m3": 1_000_000,
  "minimax-m2.7": 204_800,
  "minimax-m2.5": 204_800,
};

export type { ModelConfig } from "@chatdesk/shared";

export function formatModelLabel(model: Pick<ModelConfig, "name" | "responsive">) {
  return `${model.name} · ${model.responsive ? "Responses API" : "Chat Completions"}`;
}

export async function loadModels(): Promise<ModelConfig[]> {
  try {
    const config = await loadChatServerConfig();
    if (config.models.length > 0) {
      return config.models
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const value = item as Record<string, unknown>;
          const id = typeof value.id === "string" ? value.id : "";
          return { ...value, apiKey: config.apiKeys[id] ?? value.apiKey };
        })
        .filter(isModelConfig)
        .map(normalizeModelConfig);
    }
  } catch (error) {
    console.error("Failed to load models from Chat Server", error);
  }
  return [];
}

function normalizeModelConfig(model: ModelConfig): ModelConfig {
  return {
    ...model,
    inputContext:
      model.inputContext ?? KNOWN_MODEL_CONTEXT_WINDOWS[model.name.trim().toLowerCase()],
    supportsTools: model.supportsTools === true,
    supportsImages: model.supportsImages === true,
    supportsReasoning: model.supportsReasoning === true,
    customProtocol: model.customProtocol === true,
    responsive: model.responsive === true,
    isDefault: model.isDefault === true,
    inputPricePerMillion: normalizePrice(model.inputPricePerMillion),
    outputPricePerMillion: normalizePrice(model.outputPricePerMillion),
    cacheReadPricePerMillion: normalizePrice(model.cacheReadPricePerMillion),
    cacheWritePricePerMillion: normalizePrice(model.cacheWritePricePerMillion),
  };
}

function normalizePrice(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export async function saveModels(models: ModelConfig[]): Promise<void> {
  await saveChatServerConfig({
    models: models.map(({ apiKey: _apiKey, ...model }) => model),
    apiKeys: Object.fromEntries(models.map((model) => [model.id, model.apiKey])),
  });
}

function isModelConfig(value: unknown): value is ModelConfig {
  if (!value || typeof value !== "object") return false;
  const model = value as Partial<ModelConfig>;
  return (
    typeof model.id === "string" &&
    typeof model.name === "string" &&
    typeof model.provider === "string" &&
    typeof model.baseUrl === "string" &&
    typeof model.apiKey === "string"
  );
}
