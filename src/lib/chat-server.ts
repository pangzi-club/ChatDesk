import { invoke, isTauri as tauriIsTauri } from "@tauri-apps/api/core";
import type { UIMessage } from "ai";
import type { ChatSandboxMode } from "@/lib/chat-sandbox";
import { settingsStore } from "@/lib/settings-store";

export const CHAT_SERVER_DEFAULT_PORT = 14317;
const CHAT_SERVER_PORT_KEY = "chatServerPort";
const CHAT_SERVER_PORT_STORAGE_KEY = "m-dashboard-chat-server-port-v1";
const runtimeConfig: { port: number; token: string } = {
  port: normalizePort(import.meta.env.VITE_CHAT_SERVER_PORT),
  token: import.meta.env.VITE_CHAT_SERVER_TOKEN ?? "",
};
let runtimePortKnown = Boolean(import.meta.env.VITE_CHAT_SERVER_PORT);
let runtimeInitialization: Promise<void> | undefined;

export type ChatServerState = "running" | "starting" | "restarting" | "offline";

export type ChatServerRuntimeInfo = {
  host?: string;
  port?: unknown;
  token?: unknown;
  running?: boolean;
  state?: ChatServerState;
  restartAttempt?: number;
  lastExit?: string | null;
};

export type ChatServerHealth = {
  ok: true;
  host: string;
  port: number;
  activeRuns: number;
};

export type ChatServerConnectionStatus = {
  state: ChatServerState;
  info: ChatServerRuntimeInfo | null;
  health: ChatServerHealth | null;
};

function isTauri() {
  // `isTauri()` relies on the injected global, while older packaged webviews
  // only expose the IPC internals object.
  return tauriIsTauri() || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window);
}

function normalizePort(value: unknown) {
  const port = typeof value === "number" ? value : Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : CHAT_SERVER_DEFAULT_PORT;
}

export function initializeChatServer() {
  if (runtimeInitialization) return runtimeInitialization;
  runtimeInitialization = (async () => {
    await refreshChatServerRuntime();
  })();
  return runtimeInitialization;
}

export async function loadChatServerPort() {
  await initializeChatServer();
  if (isTauri()) {
    try {
      return normalizePort(await settingsStore.get<unknown>(CHAT_SERVER_PORT_KEY));
    } catch (error) {
      console.error("Failed to load Chat Server port", error);
    }
  }
  return normalizePort(window.localStorage.getItem(CHAT_SERVER_PORT_STORAGE_KEY));
}

export async function saveChatServerPort(port: number) {
  await initializeChatServer();
  const next = normalizePort(port);
  if (isTauri()) {
    await settingsStore.set(CHAT_SERVER_PORT_KEY, next);
    await settingsStore.save();
  }
  window.localStorage.setItem(CHAT_SERVER_PORT_STORAGE_KEY, String(next));
  return next;
}

export function getChatServerToken() {
  return runtimeConfig.token;
}

export function canRestartChatServer() {
  return isTauri();
}

export async function restartChatServer() {
  await initializeChatServer();
  if (!isTauri()) throw new Error("只有 Tauri 应用可以重启 Chat Server");
  const info = await invoke<ChatServerRuntimeInfo>("chat_server_restart");
  applyChatServerRuntime(info);
  runtimeInitialization = Promise.resolve();
  return info;
}

export function chatServerUrl(port = CHAT_SERVER_DEFAULT_PORT) {
  const stored =
    typeof window !== "undefined"
      ? normalizePort(window.localStorage.getItem(CHAT_SERVER_PORT_STORAGE_KEY))
      : CHAT_SERVER_DEFAULT_PORT;
  const selectedPort =
    port === CHAT_SERVER_DEFAULT_PORT ? (runtimePortKnown ? runtimeConfig.port : stored) : port;
  return `http://127.0.0.1:${selectedPort}`;
}

export function chatServerHeaders() {
  const token = getChatServerToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function refreshChatServerRuntime() {
  if (!isTauri()) return null;
  try {
    const info = await invoke<ChatServerRuntimeInfo>("chat_server_info");
    applyChatServerRuntime(info);
    return info;
  } catch (error) {
    console.error("Failed to refresh Chat Server authentication", error);
    return null;
  }
}

function applyChatServerRuntime(info: ChatServerRuntimeInfo) {
  if (info.port !== undefined) {
    runtimeConfig.port = normalizePort(info.port);
    runtimePortKnown = true;
  }
  if (typeof info.token === "string" && info.token) runtimeConfig.token = info.token;
}

export async function getChatServerStatus(): Promise<ChatServerConnectionStatus> {
  await initializeChatServer();
  const info = await refreshChatServerRuntime();
  const port = normalizePort(info?.port ?? (await loadChatServerPort()));
  try {
    const health = await checkChatServer(port);
    return { state: "running", info, health };
  } catch {
    const latest =
      info?.state === "starting" || info?.state === "restarting"
        ? info
        : await refreshChatServerRuntime();
    const state =
      latest?.state === "starting" || latest?.state === "restarting" ? latest.state : "offline";
    return { state, info: latest, health: null };
  }
}

async function requestChatServerResponse(
  pathname: string,
  init?: RequestInit,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  await initializeChatServer();
  const request = () => {
    const headers = new Headers(init?.headers);
    const auth = chatServerHeaders().Authorization;
    if (auth) headers.set("Authorization", auth);
    else headers.delete("Authorization");
    const url = `${chatServerUrl(port)}${pathname}`;
    return fetch(url, { ...init, headers });
  };

  const method = (init?.method ?? "GET").toUpperCase();
  const retryable = method === "GET" || method === "HEAD" || method === "OPTIONS";
  let response: Response;
  try {
    response = await request();
  } catch (error) {
    if (!isTauri() || !retryable) throw error;
    await refreshChatServerRuntime();
    response = await request();
  }
  if (response.status === 401 && isTauri()) {
    await refreshChatServerRuntime();
    response = await request();
  }
  return response;
}

export async function updateChatServerPort(port: number) {
  await initializeChatServer();
  const currentUrl = chatServerUrl();
  const savedPort = await saveChatServerPort(port);
  const currentPort = normalizePort(new URL(currentUrl).port);
  const response = await requestChatServerResponse(
    "/v1/config",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ port: savedPort }),
    },
    currentPort,
  );
  if (!response.ok) throw new Error((await response.text()) || "Chat Server 配置保存失败");
  return (await response.json()) as { port: number; restartRequired: boolean };
}

export async function checkChatServer(port = CHAT_SERVER_DEFAULT_PORT) {
  await initializeChatServer();
  const response = await fetch(`${chatServerUrl(port)}/health`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`Chat Server 返回 ${response.status}`);
  return (await response.json()) as ChatServerHealth;
}

export type ChatServerSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  attachmentCount: number;
  workspaceId?: string;
  cwd?: string;
  status: "idle" | "submitted" | "streaming" | "error" | "ready";
};

export async function loadChatServerSessions(port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await requestChatServerResponse("/v1/sessions", undefined, port);
  if (!response.ok) throw new Error((await response.text()) || "Chat Server 会话加载失败");
  return (await response.json()) as ChatServerSession[];
}

export type ChatServerConfigData = {
  models: unknown[];
  chatTools: Record<string, boolean>;
  sandboxMode?: ChatSandboxMode;
  approvalReviewerModelId?: string;
  mcpServers: unknown[];
  installedSkillIds: string[];
  selectedSkillIds: string[];
  apiKeys: Record<string, string>;
};

export type ChatServerReviewerLog = {
  id: string;
  timestamp: string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  toolName?: string;
  reasons: string[];
  decision: "approve" | "deny" | "user-approval";
  rationale?: string;
  reason?: string;
  modelId?: string;
  durationMs?: number;
  error?: string;
};

export async function chatServerRequest(
  pathname: string,
  init?: RequestInit,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await requestChatServerResponse(pathname, init, port);
  if (!response.ok)
    throw new Error((await response.text()) || `Chat Server 请求失败 (${response.status})`);
  return response;
}

export async function loadChatServerConfig(port?: number) {
  const response = await chatServerRequest("/v1/chat-config", undefined, port);
  return (await response.json()) as ChatServerConfigData;
}

export async function saveChatServerConfig(value: unknown, port?: number) {
  const response = await chatServerRequest(
    "/v1/chat-config",
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
    port,
  );
  return (await response.json()) as ChatServerConfigData;
}

export async function loadChatServerReviewerLogs(sessionId?: string, port?: number) {
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const response = await chatServerRequest(`/v1/sandbox-reviews${query}`, undefined, port);
  return (await response.json()) as ChatServerReviewerLog[];
}

export async function loadChatServerMemory(port?: number) {
  const response = await chatServerRequest("/v1/memory", undefined, port);
  return response.json();
}

export async function saveChatServerMemory(value: unknown, port?: number) {
  const response = await chatServerRequest(
    "/v1/memory",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) },
    port,
  );
  return response.json();
}

export async function loadChatServerSkills(port?: number) {
  const response = await chatServerRequest("/v1/skills", undefined, port);
  return response.json();
}

export async function loadChatServerSkillSelection(port?: number) {
  const response = await chatServerRequest("/v1/skills/selection", undefined, port);
  return (await response.json()) as string[];
}

export async function saveChatServerSkillSelection(ids: string[], port?: number) {
  const response = await chatServerRequest(
    "/v1/skills/selection",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids) },
    port,
  );
  return response.json();
}

export async function loadChatServerMcp(port?: number) {
  const response = await chatServerRequest("/v1/mcp", undefined, port);
  return response.json();
}

export async function saveChatServerMcp(value: unknown, port?: number) {
  const response = await chatServerRequest(
    "/v1/mcp",
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) },
    port,
  );
  return response.json();
}

export async function loadChatServerArchiveIndex(port?: number) {
  const response = await chatServerRequest("/v1/archive", undefined, port);
  return response.json();
}

export async function loadChatServerArchive<T>(id: string, port?: number) {
  const response = await chatServerRequest(
    `/v1/archive/${encodeURIComponent(id)}`,
    undefined,
    port,
  ).catch((error) => {
    if (String(error).includes("归档不存在") || String(error).includes("(404)")) return null;
    throw error;
  });
  return response ? ((await response.json()) as T) : null;
}

export async function saveChatServerArchive(value: { id: string }, port?: number) {
  const response = await chatServerRequest(
    `/v1/archive/${encodeURIComponent(value.id)}`,
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) },
    port,
  );
  return response.json();
}

export async function deleteChatServerArchive(id: string, port?: number) {
  await chatServerRequest(`/v1/archive/${encodeURIComponent(id)}`, { method: "DELETE" }, port);
}

export async function uploadChatServerAttachment(
  sessionId: string,
  attachmentId: string,
  fileName: string,
  bytes: Uint8Array,
  port?: number,
) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const response = await chatServerRequest(
    `/v1/sessions/${encodeURIComponent(sessionId)}/attachments`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: attachmentId, fileName, base64: btoa(binary) }),
    },
    port,
  );
  return (await response.json()) as { path: string };
}

export async function ensureChatServerSession(
  sessionId: string,
  options?: { title?: string; workspaceId?: string; cwd?: string },
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await requestChatServerResponse(
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
    undefined,
    port,
  );
  if (response.ok) return;
  if (response.status !== 404) {
    throw new Error((await response.text()) || "Chat Server 会话检查失败");
  }
  const created = await requestChatServerResponse(
    "/v1/sessions",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: sessionId, ...options }),
    },
    port,
  );
  if (!created.ok) throw new Error((await created.text()) || "Chat Server 会话创建失败");
}

export async function loadChatServerSession<T>(sessionId: string, port?: number) {
  const response = await requestChatServerResponse(
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
    undefined,
    port,
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error((await response.text()) || "Chat Server 会话读取失败");
  return (await response.json()) as T;
}

export async function saveChatServerSession(session: unknown, port?: number) {
  const value = session as { id?: unknown };
  if (typeof value.id !== "string") throw new Error("invalid chat session id");
  const response = await requestChatServerResponse(
    `/v1/sessions/${encodeURIComponent(value.id)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    },
    port,
  );
  if (!response.ok) throw new Error((await response.text()) || "Chat Server 会话保存失败");
}

export async function deleteChatServerSession(sessionId: string, port?: number) {
  const response = await requestChatServerResponse(
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" },
    port,
  );
  if (!response.ok && response.status !== 404) {
    throw new Error((await response.text()) || "Chat Server 会话删除失败");
  }
}

export async function stopChatServerRun(sessionId: string, port?: number) {
  const response = await requestChatServerResponse(
    `/v1/sessions/${encodeURIComponent(sessionId)}/runs/stop`,
    { method: "POST" },
    port,
  );
  if (!response.ok) throw new Error((await response.text()) || "Chat Server 停止任务失败");
  return (await response.json()) as { stopped: boolean };
}

export function subscribeChatServerEvents(
  port: number,
  handlers: {
    onSnapshot?: (sessions: ChatServerSession[]) => void;
    onStatus?: (event: { sessionId: string; status: ChatServerSession["status"] }) => void;
    onDelta?: (event: { sessionId: string; runId?: string; delta: string }) => void;
    onMessageUpdated?: (event: { sessionId: string; runId?: string; message?: UIMessage }) => void;
  },
) {
  let source: EventSource | undefined;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let retryAttempt = 0;

  function scheduleReconnect() {
    if (closed || reconnectTimer) return;
    const delay = [1000, 2000, 5000][Math.min(retryAttempt, 2)];
    retryAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, delay);
  }

  async function connect() {
    if (closed) return;
    if (isTauri()) await refreshChatServerRuntime();
    if (closed) return;
    const token = getChatServerToken();
    const query = token ? `?token=${encodeURIComponent(token)}` : "";
    const next = new EventSource(`${chatServerUrl(port)}/v1/events${query}`);
    source = next;
    if (isTauri()) {
      next.onopen = () => {
        retryAttempt = 0;
      };
      next.onerror = () => {
        next.close();
        if (source === next) source = undefined;
        scheduleReconnect();
      };
    }
    next.addEventListener("snapshot", (event) => {
      try {
        handlers.onSnapshot?.(JSON.parse((event as MessageEvent).data) as ChatServerSession[]);
      } catch {
        // Ignore malformed reconnect snapshots.
      }
    });
    next.addEventListener("session.status", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          sessionId?: string;
          status?: ChatServerSession["status"];
        };
        if (payload.sessionId && payload.status) {
          handlers.onStatus?.({ sessionId: payload.sessionId, status: payload.status });
        }
      } catch {
        // Ignore malformed event payloads.
      }
    });
    next.addEventListener("message.delta", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          sessionId?: string;
          runId?: string;
          delta?: string;
        };
        if (payload.sessionId && typeof payload.delta === "string") {
          handlers.onDelta?.({
            sessionId: payload.sessionId,
            runId: payload.runId,
            delta: payload.delta,
          });
        }
      } catch {
        // Ignore malformed event payloads.
      }
    });
    next.addEventListener("message.updated", (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent).data) as {
          sessionId?: string;
          runId?: string;
          message?: UIMessage;
        };
        if (payload.sessionId) {
          handlers.onMessageUpdated?.({
            sessionId: payload.sessionId,
            runId: payload.runId,
            message: payload.message,
          });
        }
      } catch {
        // Ignore malformed event payloads.
      }
    });
  }

  void connect();
  return () => {
    closed = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.close();
    source = undefined;
  };
}
