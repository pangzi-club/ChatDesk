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
  inputContext?: number;
  outputContext?: number;
  isDefault: boolean;
};

export async function loadModels(): Promise<ModelConfig[]> {
  const stored = await settingsStore.get<unknown>(MODELS_STORE_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(isModelConfig);
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
