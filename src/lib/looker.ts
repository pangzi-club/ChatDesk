import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { settingsStore } from "@/lib/settings-store";

const LOOKER_API_KEY_STORE_KEY = "lookerApiKey";
const LOOKER_API_KEY_STORAGE_KEY = "m-dashboard-looker-api-key-v1";
export const LOOKER_API_BASE_URL = "https://pointyarrow.net";
function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function resolveFetch(): typeof fetch {
  return (isTauri() ? tauriFetch : window.fetch.bind(window)) as typeof fetch;
}

export async function loadLookerApiKey(): Promise<string> {
  if (isTauri()) {
    try {
      const stored = await settingsStore.get<string>(LOOKER_API_KEY_STORE_KEY);
      if (typeof stored === "string") {
        return stored;
      }
    } catch (error) {
      console.error("Failed to load LOOKER_API_KEY from Tauri Store", error);
    }
  }

  return window.localStorage.getItem(LOOKER_API_KEY_STORAGE_KEY) ?? "";
}

export async function saveLookerApiKey(apiKey: string) {
  if (isTauri()) {
    try {
      await settingsStore.set(LOOKER_API_KEY_STORE_KEY, apiKey);
      await settingsStore.save();
      window.localStorage.removeItem(LOOKER_API_KEY_STORAGE_KEY);
      return;
    } catch (error) {
      console.error("Failed to save LOOKER_API_KEY to Tauri Store", error);
    }
  }

  window.localStorage.setItem(LOOKER_API_KEY_STORAGE_KEY, apiKey);
}

export async function clearLookerApiKey() {
  if (isTauri()) {
    try {
      await settingsStore.delete(LOOKER_API_KEY_STORE_KEY);
      await settingsStore.save();
    } catch (error) {
      console.error("Failed to clear LOOKER_API_KEY from Tauri Store", error);
    }
  }

  window.localStorage.removeItem(LOOKER_API_KEY_STORAGE_KEY);
}

export interface LookerMonitor {
  ref: string;
  id: number;
  publicId: string | null;
  name: string | null;
  taskType: number;
  taskTypeName: string;
  webUrl: string;
  keywords: string[];
  frequency: string;
  enabled: boolean;
  hasUpdate: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

interface MonitorPageInfo {
  returned: number;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface FindMonitorsResult {
  monitors: LookerMonitor[];
  pageInfo: MonitorPageInfo;
}

export interface LookerMonitorItem {
  id: number;
  externalId: string;
  title: string | null;
  content?: string | null;
  webUrl: string | null;
  publishedAt: string | null;
  collectedAt: string | null;
  source: { name: string | null; url: string | null };
  metrics: {
    views: number | null;
    likes: number | null;
    comments: number | null;
    shares: number | null;
  };
}

export interface ReadMonitorResult {
  monitor: LookerMonitor;
  items: LookerMonitorItem[];
  pageInfo: MonitorPageInfo;
}

export class LookerApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "LookerApiError";
  }
}

export async function fetchMonitors(apiKey: string): Promise<FindMonitorsResult> {
  let url: URL;
  try {
    url = new URL("/api/mcp/monitors?limit=50", LOOKER_API_BASE_URL);
  } catch {
    throw new LookerApiError("Looker API 地址格式无效");
  }

  let response: Response;
  try {
    response = await resolveFetch()(url, {
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
      },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LookerApiError(`无法连接到 Looker（${detail}）`);
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new LookerApiError("Looker API 返回了非 JSON 响应", response.status);
  }

  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message?: unknown }).message)
        : `请求失败（HTTP ${response.status}）`;
    throw new LookerApiError(message, response.status);
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !("code" in body) ||
    (body as { code?: unknown }).code !== 0 ||
    !("data" in body)
  ) {
    throw new LookerApiError("Looker API 返回了无效的响应结构", response.status);
  }

  return (body as { data: FindMonitorsResult }).data;
}

export async function fetchMonitor(ref: string, apiKey: string): Promise<ReadMonitorResult> {
  const url = new URL(
    `/api/mcp/monitors/${encodeURIComponent(ref)}?content_mode=preview&limit=50`,
    LOOKER_API_BASE_URL,
  );
  let response: Response;
  try {
    response = await resolveFetch()(url, {
      headers: { accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LookerApiError(`无法连接到 Looker（${detail}）`);
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new LookerApiError("Looker API 返回了非 JSON 响应", response.status);
  }
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "message" in body
        ? String((body as { message?: unknown }).message)
        : `请求失败（HTTP ${response.status}）`;
    throw new LookerApiError(message, response.status);
  }
  if (
    typeof body !== "object" ||
    body === null ||
    !("code" in body) ||
    (body as { code?: unknown }).code !== 0 ||
    !("data" in body)
  ) {
    throw new LookerApiError("Looker API 返回了无效的响应结构", response.status);
  }
  return (body as { data: ReadMonitorResult }).data;
}
