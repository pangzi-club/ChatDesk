import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { settingsStore } from "@/lib/settings-store";

// —— 配置 ——

export const DATAER_BASE_URL = "https://tandataer.com";
const DATAER_TIMEOUT_MS = 15_000;
const DATAER_API_KEY_STORE_KEY = "dataerApiKey";
const DATAER_API_KEY_STORAGE_KEY = "m-dashboard-dataer-api-key-v1";
const DATAER_INTERVAL_STORE_KEY = "dataerAnalyticsInterval";
const DATAER_INTERVAL_STORAGE_KEY = "m-dashboard-dataer-analytics-interval-v1";
function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * tandataer.com 不下发 CORS 响应头，webview 直连 fetch 会被拦截；
 * Tauri 环境下改走 plugin-http（Rust 侧发请求），不受 CORS 限制。
 */
function resolveFetch(): typeof fetch {
  return (isTauri() ? tauriFetch : window.fetch.bind(window)) as typeof fetch;
}

export async function loadDataerApiKey(): Promise<string> {
  if (isTauri()) {
    try {
      const stored = await settingsStore.get<string>(DATAER_API_KEY_STORE_KEY);
      if (typeof stored === "string") {
        return stored;
      }
    } catch (error) {
      console.error("Failed to load DATAER_API_KEY from Tauri Store", error);
    }
  }

  return window.localStorage.getItem(DATAER_API_KEY_STORAGE_KEY) ?? "";
}

export async function saveDataerApiKey(apiKey: string) {
  if (isTauri()) {
    try {
      await settingsStore.set(DATAER_API_KEY_STORE_KEY, apiKey);
      await settingsStore.save();
      window.localStorage.removeItem(DATAER_API_KEY_STORAGE_KEY);
      return;
    } catch (error) {
      console.error("Failed to save DATAER_API_KEY to Tauri Store", error);
    }
  }

  window.localStorage.setItem(DATAER_API_KEY_STORAGE_KEY, apiKey);
}

export async function clearDataerApiKey() {
  if (isTauri()) {
    try {
      await settingsStore.delete(DATAER_API_KEY_STORE_KEY);
      await settingsStore.save();
    } catch (error) {
      console.error("Failed to clear DATAER_API_KEY from Tauri Store", error);
    }
  }

  window.localStorage.removeItem(DATAER_API_KEY_STORAGE_KEY);
}

// —— 类型 ——

export type DataerInterval = "today" | "yesterday" | "7d" | "30d" | "90d";

const DATAER_INTERVALS: readonly DataerInterval[] = ["today", "yesterday", "7d", "30d", "90d"];

function isDataerInterval(value: unknown): value is DataerInterval {
  return typeof value === "string" && DATAER_INTERVALS.includes(value as DataerInterval);
}

export async function loadDataerAnalyticsInterval(): Promise<DataerInterval> {
  if (isTauri()) {
    try {
      const stored = await settingsStore.get<unknown>(DATAER_INTERVAL_STORE_KEY);
      if (isDataerInterval(stored)) {
        return stored;
      }
    } catch (error) {
      console.error("Failed to load analytics interval from Tauri Store", error);
    }
  }

  const stored = window.localStorage.getItem(DATAER_INTERVAL_STORAGE_KEY);
  return isDataerInterval(stored) ? stored : "7d";
}

export async function saveDataerAnalyticsInterval(interval: DataerInterval): Promise<void> {
  if (isTauri()) {
    try {
      await settingsStore.set(DATAER_INTERVAL_STORE_KEY, interval);
      await settingsStore.save();
      window.localStorage.removeItem(DATAER_INTERVAL_STORAGE_KEY);
      return;
    } catch (error) {
      console.error("Failed to save analytics interval to Tauri Store", error);
    }
  }

  window.localStorage.setItem(DATAER_INTERVAL_STORAGE_KEY, interval);
}

export interface DataerSite {
  ref: string;
  id: number;
  siteId: string;
  name: string;
  domains: string[];
  enabled: boolean;
  showOnDashboard: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DataerSiteStats {
  views: number;
  visitors: number;
  bounces: number;
  bounceRate: number;
}

export interface DataerSiteReport {
  site: DataerSite;
  generatedAt: string;
  interval: DataerInterval;
  stats: DataerSiteStats;
  eventStats: {
    total: number;
    automatic: number;
    manual: number;
    custom: number;
  };
}

export class DataerApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: number,
  ) {
    super(message);
    this.name = "DataerApiError";
  }
}

// —— 请求封装（与 tan-dataer-mcp 的 client.ts 一致）——

interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

interface PageInfo {
  returned: number;
  scanned: number;
  total: number;
  hasMore: boolean;
  nextCursor: string | null;
}

interface FindSitesResult {
  sites: DataerSite[];
  pageInfo: PageInfo;
}

async function request<T>(
  apiKey: string,
  path: string,
  searchParams: Record<string, string>,
): Promise<T> {
  const url = new URL(path, `${DATAER_BASE_URL}/`);
  for (const [key, value] of Object.entries(searchParams)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await resolveFetch()(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "x-api-key": apiKey,
      },
      signal: AbortSignal.timeout(DATAER_TIMEOUT_MS),
    });
  } catch (error) {
    console.error("Tan Dataer request failed", error);
    const timedOut =
      error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    throw new DataerApiError(
      timedOut ? `请求超时（${DATAER_TIMEOUT_MS}ms）` : `无法连接到 Tan Dataer API（${detail}）`,
    );
  }

  const text = await response.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new DataerApiError("API 返回了非 JSON 响应", response.status);
    }
  }

  if (!isApiEnvelope(body)) {
    throw new DataerApiError("API 返回了无效的响应结构", response.status);
  }

  if (!response.ok || body.code !== 0) {
    throw new DataerApiError(
      body.message || `请求失败（HTTP ${response.status}）`,
      response.status,
      body.code,
    );
  }

  return body.data as T;
}

function isApiEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const envelope = value as Partial<ApiEnvelope<unknown>>;
  return (
    typeof envelope.code === "number" && typeof envelope.message === "string" && "data" in envelope
  );
}

/** 拉取全部网站（自动跟随 cursor 翻页） */
export async function fetchAllSites(apiKey: string): Promise<DataerSite[]> {
  const sites: DataerSite[] = [];
  let cursor: string | undefined;

  do {
    const result = await request<FindSitesResult>(apiKey, "/api/mcp/analytics/sites", {
      limit: "50",
      ...(cursor === undefined ? {} : { cursor }),
    });
    sites.push(...result.sites);
    cursor = result.pageInfo.hasMore ? (result.pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor !== undefined);

  return sites;
}

/** 获取单个网站的区间报表 */
export function fetchSiteReport(
  apiKey: string,
  siteRef: string,
  interval: DataerInterval,
): Promise<DataerSiteReport> {
  return request<DataerSiteReport>(
    apiKey,
    `/api/mcp/analytics/sites/${encodeURIComponent(siteRef)}`,
    {
      interval,
      trend_metric: "views",
      include_timeseries: "false",
      include_dimensions: "false",
    },
  );
}
