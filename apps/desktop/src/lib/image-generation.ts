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
} from "@chatdesk/shared";
import { loadChatServerConfig, saveChatServerConfig } from "@/lib/chat-server";
import { desktopFetch } from "@/lib/desktop-fetch";

export type {
  GenerateImageResult,
  ImageAspectRatio,
  ImageGenerationInput,
  ImageModel,
  ImageResolution,
};
export { IMAGE_ASPECT_RATIOS, IMAGE_RESOLUTIONS, KIE_API_BASE_URL, KieApiError };

function resolveFetch(): typeof fetch {
  return desktopFetch as typeof fetch;
}

export async function loadKieApiKey(): Promise<string> {
  return (await loadChatServerConfig()).apiKeys.kie ?? "";
}

export async function saveKieApiKey(apiKey: string) {
  await saveChatServerConfig({ apiKeys: { kie: apiKey } });
}

export async function clearKieApiKey() {
  await saveChatServerConfig({ apiKeys: { kie: "" } });
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
