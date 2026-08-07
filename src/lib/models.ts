import { settingsStore } from "@/lib/settings-store";

export const MODELS_STORE_KEY = "models";

export type ModelConfig = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  customProtocol: boolean;
  /** Use OpenAI Responses API via AI SDK (`openai.responses`). */
  responsive: boolean;
  inputContext?: number;
  outputContext?: number;
  /** Estimated USD price per 1M tokens. */
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cacheReadPricePerMillion?: number;
  cacheWritePricePerMillion?: number;
  isDefault: boolean;
};

export async function loadModels(): Promise<ModelConfig[]> {
  const stored = await settingsStore.get<unknown>(MODELS_STORE_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(isModelConfig).map(normalizeModelConfig);
}

function normalizeModelConfig(model: ModelConfig): ModelConfig {
  return {
    ...model,
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
  await settingsStore.set(MODELS_STORE_KEY, models);
  await settingsStore.save();
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
