import { invoke } from "@tauri-apps/api/core";
import type { UIMessage } from "ai";
import { settingsStore } from "@/lib/settings-store";

export const CHAT_SERVER_DEFAULT_PORT = 14317;
const CHAT_SERVER_PORT_KEY = "chatServerPort";
const CHAT_SERVER_PORT_STORAGE_KEY = "m-dashboard-chat-server-port-v1";
const runtimeConfig: { port: number; token: string } = {
  port: CHAT_SERVER_DEFAULT_PORT,
  token: import.meta.env.VITE_CHAT_SERVER_TOKEN ?? "",
};
let runtimeInitialization: Promise<void> | undefined;

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizePort(value: unknown) {
  const port = typeof value === "number" ? value : Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : CHAT_SERVER_DEFAULT_PORT;
}

export function initializeChatServer() {
  if (runtimeInitialization) return runtimeInitialization;
  runtimeInitialization = (async () => {
    if (!isTauri()) return;
    try {
      const info = await invoke<{ port?: unknown; token?: unknown; running?: boolean }>(
        "chat_server_info",
      );
      if (info.running === true) {
        runtimeConfig.port = normalizePort(info.port);
        if (typeof info.token === "string" && info.token) runtimeConfig.token = info.token;
      }
    } catch (error) {
      console.error("Failed to initialize Chat Server", error);
    }
  })();
  return runtimeInitialization;
}

export async function loadChatServerPort() {
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

export function chatServerUrl(port = CHAT_SERVER_DEFAULT_PORT) {
  const stored =
    typeof window !== "undefined"
      ? normalizePort(window.localStorage.getItem(CHAT_SERVER_PORT_STORAGE_KEY))
      : CHAT_SERVER_DEFAULT_PORT;
  const selectedPort =
    port === CHAT_SERVER_DEFAULT_PORT
      ? runtimeConfig.port !== CHAT_SERVER_DEFAULT_PORT
        ? runtimeConfig.port
        : stored
      : port;
  return `http://127.0.0.1:${selectedPort}`;
}

export function chatServerHeaders() {
  const token = getChatServerToken();
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function updateChatServerPort(port: number) {
  const currentUrl = chatServerUrl();
  const savedPort = await saveChatServerPort(port);
  const response = await fetch(`${currentUrl}/v1/config`, {
    method: "PATCH",
    headers: { ...chatServerHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ port: savedPort }),
  });
  if (!response.ok) throw new Error((await response.text()) || "Chat Server 配置保存失败");
  return (await response.json()) as { port: number; restartRequired: boolean };
}

export async function checkChatServer(port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await fetch(`${chatServerUrl(port)}/health`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!response.ok) throw new Error(`Chat Server 返回 ${response.status}`);
  return (await response.json()) as { ok: true; host: string; port: number; activeRuns: number };
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
  const response = await fetch(`${chatServerUrl(port)}/v1/sessions`, {
    headers: chatServerHeaders(),
  });
  if (!response.ok) throw new Error((await response.text()) || "Chat Server 会话加载失败");
  return (await response.json()) as ChatServerSession[];
}

export async function ensureChatServerSession(
  sessionId: string,
  options?: { title?: string; workspaceId?: string; cwd?: string },
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await fetch(
    `${chatServerUrl(port)}/v1/sessions/${encodeURIComponent(sessionId)}`,
    {
      headers: chatServerHeaders(),
    },
  );
  if (response.ok) return;
  if (response.status !== 404) {
    throw new Error((await response.text()) || "Chat Server 会话检查失败");
  }
  const created = await fetch(`${chatServerUrl(port)}/v1/sessions`, {
    method: "POST",
    headers: { ...chatServerHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ id: sessionId, ...options }),
  });
  if (!created.ok) throw new Error((await created.text()) || "Chat Server 会话创建失败");
}

export async function loadChatServerSession<T>(sessionId: string, port?: number) {
  const response = await fetch(
    `${chatServerUrl(port ?? CHAT_SERVER_DEFAULT_PORT)}/v1/sessions/${encodeURIComponent(sessionId)}`,
    { headers: chatServerHeaders() },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error((await response.text()) || "Chat Server 会话读取失败");
  return (await response.json()) as T;
}

export async function saveChatServerSession(session: unknown, port?: number) {
  const value = session as { id?: unknown };
  if (typeof value.id !== "string") throw new Error("invalid chat session id");
  const response = await fetch(
    `${chatServerUrl(port ?? CHAT_SERVER_DEFAULT_PORT)}/v1/sessions/${encodeURIComponent(value.id)}`,
    {
      method: "PATCH",
      headers: { ...chatServerHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(session),
    },
  );
  if (!response.ok) throw new Error((await response.text()) || "Chat Server 会话保存失败");
}

export async function deleteChatServerSession(sessionId: string, port?: number) {
  const response = await fetch(
    `${chatServerUrl(port ?? CHAT_SERVER_DEFAULT_PORT)}/v1/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE", headers: chatServerHeaders() },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error((await response.text()) || "Chat Server 会话删除失败");
  }
}

export async function stopChatServerRun(sessionId: string, port?: number) {
  const response = await fetch(
    `${chatServerUrl(port ?? CHAT_SERVER_DEFAULT_PORT)}/v1/sessions/${encodeURIComponent(sessionId)}/runs/stop`,
    { method: "POST", headers: chatServerHeaders() },
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
  const token = getChatServerToken();
  const query = token ? `?token=${encodeURIComponent(token)}` : "";
  const source = new EventSource(`${chatServerUrl(port)}/v1/events${query}`);
  source.addEventListener("snapshot", (event) => {
    try {
      handlers.onSnapshot?.(JSON.parse((event as MessageEvent).data) as ChatServerSession[]);
    } catch {
      // Ignore malformed reconnect snapshots.
    }
  });
  source.addEventListener("session.status", (event) => {
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
  source.addEventListener("message.delta", (event) => {
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
  source.addEventListener("message.updated", (event) => {
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
  return () => source.close();
}
