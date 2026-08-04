import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { settingsStore } from "@/lib/settings-store";

export const COMMIT_API_BASE_URL =
  import.meta.env.VITE_COMMIT_API_BASE_URL ?? "https://commit-summary.bj050323.workers.dev";
const COMMIT_API_KEY_STORE_KEY = "commitApiKey";
const COMMIT_API_KEY_STORAGE_KEY = "m-dashboard-commit-api-key-v1";
function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function resolveFetch(): typeof fetch {
  return (isTauri() ? tauriFetch : window.fetch.bind(window)) as typeof fetch;
}

export async function loadCommitApiKey(): Promise<string> {
  if (isTauri()) {
    try {
      const stored = await settingsStore.get<string>(COMMIT_API_KEY_STORE_KEY);
      if (typeof stored === "string") return stored;
    } catch (error) {
      console.error("Failed to load COMMIT_API_KEY from Tauri Store", error);
    }
  }
  return window.localStorage.getItem(COMMIT_API_KEY_STORAGE_KEY) ?? "";
}

export async function saveCommitApiKey(apiKey: string) {
  if (isTauri()) {
    try {
      await settingsStore.set(COMMIT_API_KEY_STORE_KEY, apiKey);
      await settingsStore.save();
      window.localStorage.removeItem(COMMIT_API_KEY_STORAGE_KEY);
      return;
    } catch (error) {
      console.error("Failed to save COMMIT_API_KEY to Tauri Store", error);
    }
  }
  window.localStorage.setItem(COMMIT_API_KEY_STORAGE_KEY, apiKey);
}

export async function clearCommitApiKey() {
  if (isTauri()) {
    try {
      await settingsStore.delete(COMMIT_API_KEY_STORE_KEY);
      await settingsStore.save();
    } catch (error) {
      console.error("Failed to clear COMMIT_API_KEY from Tauri Store", error);
    }
  }
  window.localStorage.removeItem(COMMIT_API_KEY_STORAGE_KEY);
}

export interface CommitActivityDay {
  date: string;
  count: number;
}

export interface CommitActivity {
  rangeStart: string;
  rangeEnd: string;
  totalCommits: number;
  activeDays: number;
  longestStreak: number;
  repositories: number;
  days: CommitActivityDay[];
}

export interface CommitOverview {
  filters: unknown;
  activity: CommitActivity;
  currentMonth: {
    month: string;
    totalCommits: number;
    repositories: Array<{ repositoryFullName: string; count: number }>;
  };
}

export interface CommitItem {
  id: number;
  sha: string;
  message: string;
  authorName: string | null;
  authorLogin: string | null;
  committedAt: string;
  branches: string[];
  htmlUrl: string;
  repository: { name: string; fullName: string; isPrivate: boolean };
}

export class CommitApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "CommitApiError";
  }
}

async function request<T>(apiKey: string, path: string): Promise<T> {
  let response: Response;
  try {
    response = await resolveFetch()(new URL(path, `${COMMIT_API_BASE_URL}/`), {
      headers: { accept: "application/json", "x-api-key": apiKey },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new CommitApiError(`无法连接到 Commit Summary（${detail}）`);
  }

  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new CommitApiError("Commit Summary API 返回了非 JSON 响应", response.status);
  }
  if (!response.ok || typeof body !== "object" || body === null || !("ok" in body)) {
    const message =
      typeof body === "object" && body !== null && "error" in body
        ? String((body as { error?: { message?: unknown } }).error?.message ?? "请求失败")
        : `请求失败（HTTP ${response.status}）`;
    throw new CommitApiError(message, response.status);
  }
  if ((body as { ok: unknown }).ok !== true || !("data" in body)) {
    throw new CommitApiError("Commit Summary API 返回了无效的响应结构", response.status);
  }
  return (body as { data: T }).data;
}

export function fetchCommitOverview(apiKey: string) {
  return request<CommitOverview>(apiKey, "/api/v1/overview");
}

export function fetchRecentCommits(apiKey: string) {
  return request<{ data: CommitItem[]; total: number }>(
    apiKey,
    "/api/v1/commits?page=1&pageSize=20",
  );
}
