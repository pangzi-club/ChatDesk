import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { loadChatServerConfig, saveChatServerConfig } from "@/lib/chat-server";
import { settingsStore } from "@/lib/settings-store";
import {
  type GenerateImageResult,
  generateImageWithApiKey,
  IMAGE_ASPECT_RATIOS,
  IMAGE_RESOLUTIONS,
  type ImageAspectRatio,
  type ImageGenerationInput,
  type ImageModel,
  type ImageResolution,
  KIE_API_BASE_URL,
  KieApiError,
} from "@/shared/image-generation";

export type {
  GenerateImageResult,
  ImageAspectRatio,
  ImageGenerationInput,
  ImageModel,
  ImageResolution,
};
export { IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS, KIE_API_BASE_URL, KieApiError };

const KIE_API_KEY_STORE_KEY = "kieApiKey";
const KIE_API_KEY_STORAGE_KEY = "m-dashboard-kie-api-key-v1";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function resolveFetch(): typeof fetch {
  return (isTauri() ? tauriFetch : window.fetch.bind(window)) as typeof fetch;
}

export async function loadKieApiKey(): Promise<string> {
  try {
    const value = (await loadChatServerConfig()).apiKeys.kie;
    if (value) return value;
  } catch {
    // Fall back to the legacy store during bootstrap.
  }
  if (isTauri()) {
    try {
      const stored = await settingsStore.get<string>(KIE_API_KEY_STORE_KEY);
      if (typeof stored === "string") return stored;
    } catch (error) {
      console.error("Failed to load KIE_API_KEY from Tauri Store", error);
    }
  }
  return window.localStorage.getItem(KIE_API_KEY_STORAGE_KEY) ?? "";
}

export async function saveKieApiKey(apiKey: string) {
  await saveChatServerConfig({ apiKeys: { kie: apiKey } });
  if (isTauri()) {
    try {
      await settingsStore.set(KIE_API_KEY_STORE_KEY, apiKey);
      await settingsStore.save();
      window.localStorage.removeItem(KIE_API_KEY_STORAGE_KEY);
      return;
    } catch (error) {
      console.error("Failed to save KIE_API_KEY to Tauri Store", error);
    }
  }
  window.localStorage.setItem(KIE_API_KEY_STORAGE_KEY, apiKey);
}

export async function clearKieApiKey() {
  if (isTauri()) {
    try {
      await settingsStore.delete(KIE_API_KEY_STORE_KEY);
      await settingsStore.save();
    } catch (error) {
      console.error("Failed to clear KIE_API_KEY from Tauri Store", error);
    }
  }
  window.localStorage.removeItem(KIE_API_KEY_STORAGE_KEY);
}

export const IMAGE_MODELS: Array<{ value: ImageModel; label: string }> = [
  { value: "gpt-image-2-text-to-image", label: "GPT Image 2" },
];

export async function generateImage(
  input: ImageGenerationInput,
  options?: { abortSignal?: AbortSignal },
): Promise<GenerateImageResult> {
  return generateImageWithApiKey((await loadKieApiKey()).trim(), input, {
    abortSignal: options?.abortSignal,
    fetchImpl: resolveFetch(),
  });
}

export async function downloadGeneratedImage(url: string): Promise<Blob> {
  const response = await resolveFetch()(url, { method: "GET" });
  if (!response.ok)
    throw new KieApiError(`图片下载失败（HTTP ${response.status}）`, response.status);
  return response.blob();
}
