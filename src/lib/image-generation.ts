import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { settingsStore } from "@/lib/settings-store";

export const KIE_API_BASE_URL = "https://api.kie.ai";
const KIE_API_KEY_STORE_KEY = "kieApiKey";
const KIE_API_KEY_STORAGE_KEY = "m-dashboard-kie-api-key-v1";
const POLL_INTERVAL_MS = 5_000;
const MAX_POLL_ATTEMPTS = 90;

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function resolveFetch(): typeof fetch {
  return (isTauri() ? tauriFetch : window.fetch.bind(window)) as typeof fetch;
}

export async function loadKieApiKey(): Promise<string> {
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

export type ImageAspectRatio =
  | "auto"
  | "1:1"
  | "3:2"
  | "2:3"
  | "4:3"
  | "3:4"
  | "16:9"
  | "9:16"
  | "2:1"
  | "1:2"
  | "3:1"
  | "1:3"
  | "21:9"
  | "9:21"
  | "5:4"
  | "4:5";
export type ImageResolution = "1K" | "2K" | "4K";
export type ImageModel = "gpt-image-2-text-to-image";

export const IMAGE_MODELS: Array<{ value: ImageModel; label: string }> = [
  { value: "gpt-image-2-text-to-image", label: "GPT Image 2" },
];

export interface ImageGenerationInput {
  model: ImageModel;
  prompt: string;
  aspect_ratio: ImageAspectRatio;
  resolution: ImageResolution;
}

export class KieApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KieApiError";
  }
}

interface KieEnvelope<T> {
  code: number;
  msg: string;
  data: T;
}

interface TaskRecord {
  taskId: string;
  state: "waiting" | "success" | "fail" | string;
  resultJson?: string | null;
  failMsg?: string | null;
}

async function request<T>(apiKey: string, input: RequestInit, path: string): Promise<T> {
  let response: Response;
  try {
    response = await resolveFetch()(new URL(path, KIE_API_BASE_URL), {
      ...input,
      headers: {
        accept: "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...input.headers,
      },
      signal: AbortSignal.timeout(30_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new KieApiError(`无法连接到 KIE API（${detail}）`);
  }

  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new KieApiError("KIE API 返回了非 JSON 响应", response.status);
  }
  if (!response.ok || !isEnvelope(body) || body.code !== 200) {
    const message = isEnvelope(body) ? body.msg : `请求失败（HTTP ${response.status}）`;
    throw new KieApiError(message || "KIE API 请求失败", response.status);
  }
  return body.data as T;
}

function isEnvelope(value: unknown): value is KieEnvelope<unknown> {
  return typeof value === "object" && value !== null && "code" in value && "data" in value;
}

export async function generateImage(input: ImageGenerationInput): Promise<string[]> {
  const apiKey = (await loadKieApiKey()).trim();
  if (!apiKey) throw new KieApiError("请先在设置中配置 KIE_API_KEY。");
  const task = await request<{ taskId: string }>(
    apiKey,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: input.model, input }),
    },
    "/api/v1/jobs/createTask",
  );
  if (!task.taskId) throw new KieApiError("KIE API 未返回 taskId。");

  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
    const record = await request<TaskRecord>(
      apiKey,
      { method: "GET" },
      `/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(task.taskId)}`,
    );
    if (record.state === "success") {
      try {
        const parsed = JSON.parse(record.resultJson ?? "{}");
        const urls = Array.isArray(parsed.resultUrls) ? parsed.resultUrls : [];
        if (urls.every((url: unknown) => typeof url === "string") && urls.length > 0) {
          return urls as string[];
        }
      } catch {
        // Continue with a useful error below if the result payload is malformed.
      }
      throw new KieApiError("任务已完成，但未返回图片地址。");
    }
    if (record.state === "fail") throw new KieApiError(record.failMsg || "图片生成失败。");
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new KieApiError("图片生成超时，请稍后重试。");
}

export async function downloadGeneratedImage(url: string): Promise<Blob> {
  const response = await resolveFetch()(url, { method: "GET" });
  if (!response.ok)
    throw new KieApiError(`图片下载失败（HTTP ${response.status}）`, response.status);
  return response.blob();
}
