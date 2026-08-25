import { ChatServerClient, ChatServerError } from "@chatdesk/chat-server-client";
import type {
  ChatContextCompaction,
  ChatContextUsage,
  ChatIndexItem,
  ChatJobOutputPage,
  ChatJobSummary,
  ChatPlanMode,
  ChatPlanSummary,
  ChatRunProgress,
  ChatRunSummary,
  ChatServerAiUsageLog,
  ChatServerConfigData,
  ChatServerProviderModel,
  ChatServerReviewerLog,
  ChatSession,
  DeveloperEnvironmentStatus,
  HealthResponse,
  RunStartInput,
  SessionIndexItem,
  SystemPromptSnapshot,
  WorkspaceGitCommitResult,
  WorkspaceGitDiff,
  WorkspaceListResult,
  WorkspacePathSuggestionResult,
} from "@chatdesk/shared";
import type { UIMessage } from "ai";
import { getDesktopBridge, isDesktop } from "@/lib/desktop-bridge";
import { desktopFetch } from "@/lib/desktop-fetch";
import { settingsStore } from "@/lib/settings-store";

export const CHAT_SERVER_DEFAULT_PORT = 14317;
const CHAT_SERVER_PORT_KEY = "chatServerPort";
const CHAT_SERVER_PORT_STORAGE_KEY = "m-dashboard-chat-server-port-v1";
const runtimeConfig: { port: number; token: string; managed: boolean } = {
  port: normalizePort(import.meta.env.VITE_CHAT_SERVER_PORT),
  token: import.meta.env.VITE_CHAT_SERVER_TOKEN ?? "",
  managed: !import.meta.env.DEV,
};
let runtimePortKnown = Boolean(import.meta.env.VITE_CHAT_SERVER_PORT);
let runtimeInitialization: Promise<void> | undefined;

export type ChatServerState = "running" | "starting" | "restarting" | "offline";

export type ChatServerRuntimeInfo = {
  host?: string;
  port?: unknown;
  token?: unknown;
  managed?: boolean;
  running?: boolean;
  state?: ChatServerState;
  restartAttempt?: number;
  lastExit?: string | null;
};

export type ChatServerHealth = HealthResponse;
export type ChatServerConnectionStatus = {
  state: ChatServerState;
  info: ChatServerRuntimeInfo | null;
  health: ChatServerHealth | null;
};
export type ChatServerSession = SessionIndexItem;
export type PlatformCapabilities = {
  platform: string;
  git: boolean;
  shell: boolean;
  restrictedShell: boolean;
  processManagement: boolean;
};
export type ServerWorkspaceProject = {
  id: string;
  path: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  removedAt?: string;
};
export type SystemPromptPreview = SystemPromptSnapshot;

export type {
  WorkspaceGitCommitResult,
  WorkspaceGitDiff,
  WorkspaceListResult,
  WorkspacePathSuggestionResult,
} from "@chatdesk/shared";
export type {
  ChatIndexItem,
  ChatServerAiUsageLog,
  ChatServerConfigData,
  ChatServerProviderModel,
  ChatServerReviewerLog,
  ChatSession,
  DeveloperEnvironmentStatus,
};
export type ChatPlan = ChatPlanSummary & { content: string };
export type ChatJob = ChatJobSummary;

function normalizePort(value: unknown) {
  const port = typeof value === "number" ? value : Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : CHAT_SERVER_DEFAULT_PORT;
}

async function runtimeFetch(input: RequestInfo | URL, init: RequestInit | undefined) {
  const method = (init?.method ?? "GET").toUpperCase();
  const retryable = method === "GET" || method === "HEAD" || method === "OPTIONS";
  const request = () => {
    const headers = new Headers(init?.headers);
    if (runtimeConfig.token) headers.set("Authorization", `Bearer ${runtimeConfig.token}`);
    else headers.delete("Authorization");
    const bridge = getDesktopBridge();
    const useElectronBridge = bridge?.runtime === "electron" && !import.meta.env.DEV;
    return (useElectronBridge ? desktopFetch : fetch)(
      resolveChatServerRequestInput(input, {
        runtime: bridge?.runtime,
        development: import.meta.env.DEV,
        port: runtimeConfig.port,
      }),
      {
        ...init,
        headers,
        ...({ targetAddressSpace: "loopback" } as RequestInit),
      },
    );
  };

  let response: Response;
  try {
    response = await request();
  } catch (error) {
    if (!isDesktop() || !retryable) throw error;
    await refreshChatServerRuntime();
    response = await request();
  }
  if (response.status === 401 && isDesktop()) {
    await refreshChatServerRuntime();
    response = await request();
  }
  return response;
}

export function resolveChatServerRequestInput(
  input: RequestInfo | URL,
  options: { runtime?: string; development: boolean; port: number },
) {
  if (options.runtime !== "electron" || options.development) return input;
  const source = input instanceof Request ? input.url : String(input);
  const url = new URL(source);
  if (url.protocol !== "chatdesk:" || url.hostname !== "localhost") return input;
  return `http://127.0.0.1:${normalizePort(options.port)}${url.pathname}${url.search}`;
}

function createClient(port = CHAT_SERVER_DEFAULT_PORT) {
  return new ChatServerClient({
    baseUrl: chatServerUrl(port),
    token: () => runtimeConfig.token,
    fetchImpl: (input, init) => runtimeFetch(input, init),
    onBeforeReconnect: async () => {
      await refreshChatServerRuntime();
    },
  });
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
  if (isDesktop()) {
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
  if (isDesktop()) {
    await settingsStore.set(CHAT_SERVER_PORT_KEY, next);
    await settingsStore.save();
    return next;
  }
  window.localStorage.setItem(CHAT_SERVER_PORT_STORAGE_KEY, String(next));
  return next;
}

export function getChatServerToken() {
  return runtimeConfig.token;
}

export function canRestartChatServer() {
  return isDesktop() && runtimeConfig.managed;
}

export function canMonitorChatServer() {
  return isDesktop();
}

export async function restartChatServer() {
  await initializeChatServer();
  const bridge = getDesktopBridge();
  if (!bridge) throw new Error("只有桌面应用可以重启 Chat Server");
  const info = await bridge.call<ChatServerRuntimeInfo>("chat_server_restart");
  applyChatServerRuntime(info);
  runtimeInitialization = Promise.resolve();
  return info;
}

export function chatServerPort(port = CHAT_SERVER_DEFAULT_PORT) {
  const stored = isDesktop()
    ? CHAT_SERVER_DEFAULT_PORT
    : normalizePort(window.localStorage.getItem(CHAT_SERVER_PORT_STORAGE_KEY));
  return port === CHAT_SERVER_DEFAULT_PORT
    ? runtimePortKnown
      ? runtimeConfig.port
      : stored
    : port;
}

export function resolveChatServerBaseUrl(port: number, options?: { proxyOrigin?: string | null }) {
  const origin = options?.proxyOrigin?.replace(/\/$/, "");
  if (origin) return origin;
  return `http://127.0.0.1:${port}`;
}

function electronProxyOrigin() {
  if (typeof window === "undefined") return null;
  return resolveElectronProxyOrigin({
    runtime: getDesktopBridge()?.runtime,
    development: import.meta.env.DEV,
    rendererOrigin: window.location.origin,
  });
}

export function resolveElectronProxyOrigin(options: {
  runtime?: string;
  development: boolean;
  rendererOrigin: string;
}) {
  if (options.runtime !== "electron") return null;
  return options.development ? options.rendererOrigin : "chatdesk://localhost";
}

export function chatServerUrl(port = CHAT_SERVER_DEFAULT_PORT) {
  return resolveChatServerBaseUrl(chatServerPort(port), {
    proxyOrigin: electronProxyOrigin(),
  });
}

export function chatServerHeaders() {
  const headers: Record<string, string> = {};
  if (runtimeConfig.token) headers.Authorization = `Bearer ${runtimeConfig.token}`;
  return headers;
}

export async function refreshChatServerRuntime() {
  const bridge = getDesktopBridge();
  if (!bridge) return null;
  try {
    const info = await bridge.call<ChatServerRuntimeInfo>("chat_server_info");
    applyChatServerRuntime(info);
    return info;
  } catch (error) {
    console.error("Failed to refresh Chat Server authentication", error);
    return null;
  }
}

function applyChatServerRuntime(info: ChatServerRuntimeInfo | null | undefined) {
  if (!info) return;
  if (info.port !== undefined) {
    runtimeConfig.port = normalizePort(info.port);
    runtimePortKnown = true;
  }
  if (typeof info.token === "string" && info.token) runtimeConfig.token = info.token;
  if (typeof info.managed === "boolean") runtimeConfig.managed = info.managed;
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
  return createClient(port).request(pathname, init);
}

export async function updateChatServerPort(port: number) {
  await initializeChatServer();
  const savedPort = await saveChatServerPort(port);
  const currentPort = chatServerPort();
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
  const response = await requestChatServerResponse(
    "/health",
    { signal: AbortSignal.timeout(1500) },
    port,
  );
  if (!response.ok) throw new Error(`Chat Server 返回 ${response.status}`);
  return (await response.json()) as ChatServerHealth;
}

export async function loadChatServerSessions(
  options: { query?: string; limit?: number } = {},
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return (await createClient(port).listSessions(options)) as ChatServerSession[];
}

export async function chatServerRequest(
  pathname: string,
  init?: RequestInit,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await requestChatServerResponse(pathname, init, port);
  if (!response.ok) {
    throw new ChatServerError(
      (await response.text()) || `Chat Server 请求失败 (${response.status})`,
      response.status,
    );
  }
  return response;
}

function withWorkspaceCwd(pathname: string, cwd?: string) {
  if (!cwd?.trim()) return pathname;
  return `${pathname}${pathname.includes("?") ? "&" : "?"}cwd=${encodeURIComponent(cwd.trim())}`;
}

export async function loadPlatformCapabilities(port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await chatServerRequest("/v1/platform/capabilities", undefined, port);
  return (await response.json()) as PlatformCapabilities;
}

export async function loadServerWorkspaces(port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await chatServerRequest("/v1/workspaces", undefined, port);
  return (await response.json()) as ServerWorkspaceProject[];
}

export async function registerServerWorkspace(
  value: { path: string; name?: string },
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    "/v1/workspaces",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
    port,
  );
  return (await response.json()) as ServerWorkspaceProject;
}

export async function removeServerWorkspace(id: string, port = CHAT_SERVER_DEFAULT_PORT) {
  await chatServerRequest(`/v1/workspaces/${encodeURIComponent(id)}`, { method: "DELETE" }, port);
}

export async function loadServerWorkspaceGit(
  id: string,
  cwd?: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    withWorkspaceCwd(`/v1/workspaces/${encodeURIComponent(id)}/git`, cwd),
    undefined,
    port,
  );
  return response.json();
}

export async function loadServerWorkspaceFiles(
  id: string,
  relativePath = ".",
  cwd?: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    withWorkspaceCwd(
      `/v1/workspaces/${encodeURIComponent(id)}/files?path=${encodeURIComponent(relativePath)}`,
      cwd,
    ),
    undefined,
    port,
  );
  return (await response.json()) as WorkspaceListResult;
}

export async function loadServerWorkspacePathSuggestions(
  id: string,
  query: string,
  cwd?: string,
  maxResults = 20,
  signal?: AbortSignal,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    withWorkspaceCwd(`/v1/workspaces/${encodeURIComponent(id)}/path-suggestions`, cwd),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, maxResults }),
      signal,
    },
    port,
  );
  return (await response.json()) as WorkspacePathSuggestionResult;
}

export async function loadServerWorkspaceGitDiff(
  id: string,
  filePath: string,
  cwd?: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    withWorkspaceCwd(
      `/v1/workspaces/${encodeURIComponent(id)}/git/diff?path=${encodeURIComponent(filePath)}`,
      cwd,
    ),
    undefined,
    port,
  );
  return (await response.json()) as WorkspaceGitDiff;
}

export async function restoreServerWorkspaceGit(
  id: string,
  filePath?: string,
  cwd?: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  await chatServerRequest(
    withWorkspaceCwd(`/v1/workspaces/${encodeURIComponent(id)}/git/restore`, cwd),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(filePath ? { path: filePath, cwd } : { cwd }),
    },
    port,
  );
}

export async function commitServerWorkspaceGit(
  id: string,
  value: { message?: string; push?: boolean; cwd?: string },
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    withWorkspaceCwd(`/v1/workspaces/${encodeURIComponent(id)}/git/commit`, value.cwd),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
    port,
  );
  return (await response.json()) as WorkspaceGitCommitResult;
}

export async function pushServerWorkspaceGit(
  id: string,
  cwd?: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    withWorkspaceCwd(`/v1/workspaces/${encodeURIComponent(id)}/git/push`, cwd),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd }),
    },
    port,
  );
  return (await response.json()) as WorkspaceGitCommitResult;
}

export async function loadServerWorkspaceFile(
  id: string,
  filePath: string,
  cwd?: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    withWorkspaceCwd(`/v1/workspaces/${encodeURIComponent(id)}/file`, cwd),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", path: filePath, cwd }),
    },
    port,
  );
  return (await response.json()) as { path: string; content: string };
}

export async function loadServerAutomations(port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await chatServerRequest("/v1/automations", undefined, port);
  return response.json();
}

export async function saveServerAutomations(value: unknown, port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await chatServerRequest(
    "/v1/automations",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
    port,
  );
  return response.json();
}

export async function loadServerActivityLogs(port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await chatServerRequest("/v1/activity-logs", undefined, port);
  return response.json();
}

export async function clearServerActivityLogs(port = CHAT_SERVER_DEFAULT_PORT) {
  await chatServerRequest("/v1/activity-logs", { method: "DELETE" }, port);
}

export async function appendServerActivityLog(value: unknown, port = CHAT_SERVER_DEFAULT_PORT) {
  await chatServerRequest(
    "/v1/activity-logs",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
    port,
  );
}

export async function loadServerViteProcesses(port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await chatServerRequest("/v1/processes/vite", undefined, port);
  return response.json();
}

export async function terminateServerViteProcess(pid: number, port = CHAT_SERVER_DEFAULT_PORT) {
  await chatServerRequest(`/v1/processes/vite/${pid}/terminate`, { method: "POST" }, port);
}

export async function loadServerImageGeneration(port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await chatServerRequest("/v1/image-generation", undefined, port);
  return response.json();
}

export async function saveServerImageGeneration(value: unknown, port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await chatServerRequest(
    "/v1/image-generation",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    },
    port,
  );
  return response.json();
}

export async function loadChatServerConfig(port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).getConfig();
}

export async function saveChatServerConfig(value: unknown, port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).saveConfig(value);
}

export async function loadDeveloperEnvironment(port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).getDeveloperEnvironment();
}

export async function importDeveloperEnvironment(port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).importDeveloperEnvironment();
}

export async function testChatServerModel(
  model: { name: string; baseUrl: string; apiKey: string; responsive?: boolean },
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).testModel(model);
}

export async function listChatServerModels(
  input: { baseUrl: string; apiKey: string },
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).listModels(input);
}

export async function loadChatServerReviewerLogs(
  sessionId?: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).getReviewerLogs(sessionId);
}

export async function loadChatServerAiUsageLogs(port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).getAiUsageLogs();
}

export async function loadChatServerMemory(port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).getMemory();
}

export async function saveChatServerMemory(value: unknown, port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).saveMemory(value);
}

export async function loadChatServerSkills(port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).getSkills();
}

export async function loadChatServerSkillSelection(port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).getSkillSelection();
}

export async function saveChatServerSkillSelection(ids: string[], port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).saveSkillSelection(ids);
}

export async function loadChatServerMcp(port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).getMcp();
}

export async function saveChatServerMcp(value: unknown, port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).saveMcp(value);
}

export async function loadChatServerArchiveIndex(port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).getArchiveIndex();
}

export async function loadChatServerArchive<T>(id: string, port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).getArchive<T>(id);
}

export async function saveChatServerArchive(
  value: { id: string },
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).saveArchive(value);
}

export async function deleteChatServerArchive(id: string, port = CHAT_SERVER_DEFAULT_PORT) {
  await createClient(port).deleteArchive(id);
}

export async function uploadChatServerArchive(
  source: "codex" | "claude-code" | "cursor" | "kimi",
  file: File,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const form = new FormData();
  form.set("source", source);
  form.set("file", file);
  const response = await chatServerRequest(
    "/v1/archive/upload",
    { method: "POST", body: form },
    port,
  );
  if (!response.ok) throw new Error((await response.text()) || "归档文件上传失败");
  return (await response.json()) as {
    source: typeof source;
    sourcePath: string;
    size: number;
    fileName: string;
  };
}

export async function uploadChatServerAttachment(
  sessionId: string,
  attachmentId: string,
  fileName: string,
  bytes: Uint8Array,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).uploadAttachment(sessionId, attachmentId, fileName, bytes);
}

export async function downloadChatServerAttachment(
  sessionId: string,
  attachmentId: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).downloadAttachment(sessionId, attachmentId);
}

export async function ensureChatServerSession(
  sessionId: string,
  options?: { title?: string; workspaceId?: string; cwd?: string },
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  await createClient(port).ensureSession(sessionId, options);
}

export async function createChatPlan(sessionId: string, port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await chatServerRequest(
    `/v1/sessions/${encodeURIComponent(sessionId)}/plans`,
    { method: "POST" },
    port,
  );
  return (await response.json()) as ChatPlan;
}

export async function updateChatPlanMode(
  sessionId: string,
  planMode: ChatPlanMode,
  activePlanId?: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    `/v1/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ planMode, activePlanId }),
    },
    port,
  );
  return (await response.json()) as ChatSession;
}

export async function loadChatPlans(sessionId: string, port = CHAT_SERVER_DEFAULT_PORT) {
  const response = await chatServerRequest(
    `/v1/sessions/${encodeURIComponent(sessionId)}/plans`,
    undefined,
    port,
  );
  return (await response.json()) as ChatPlanSummary[];
}

export async function loadChatPlan(
  sessionId: string,
  planId: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    `/v1/sessions/${encodeURIComponent(sessionId)}/plans/${encodeURIComponent(planId)}`,
    undefined,
    port,
  );
  return (await response.json()) as ChatPlan;
}

export async function loadChatServerSession<T extends ChatSession>(
  sessionId: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).loadSession<T>(sessionId);
}

export async function saveChatServerSession(session: unknown, port = CHAT_SERVER_DEFAULT_PORT) {
  const value = session as { id?: unknown };
  if (typeof value.id !== "string") throw new Error("invalid chat session id");
  await createClient(port).saveSession(session as ChatSession);
}

export async function forkChatServerSession(
  sessionId: string,
  options: { messageId: string },
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).forkSession(sessionId, options);
}

export async function regenerateChatSessionTitle(
  sessionId: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).regenerateSessionTitle(sessionId);
}

export async function updateChatSessionTitle(
  sessionId: string,
  title: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).updateSessionTitle(sessionId, title);
}

export async function deleteChatServerSession(sessionId: string, port = CHAT_SERVER_DEFAULT_PORT) {
  await createClient(port).deleteSession(sessionId);
}

export async function stopChatServerRun(sessionId: string, port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).stopRun(sessionId);
}

export async function loadChatServerJobs(sessionId: string, port = CHAT_SERVER_DEFAULT_PORT) {
  return createClient(port).listJobs(sessionId);
}

export async function loadChatServerJob(
  jobId: string,
  sessionId: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).getJob(jobId, sessionId);
}

export async function loadChatServerJobOutput(
  jobId: string,
  sessionId: string,
  cursor = 0,
  port = CHAT_SERVER_DEFAULT_PORT,
): Promise<ChatJobOutputPage> {
  return createClient(port).getJobOutput(jobId, sessionId, cursor);
}

export async function stopChatServerJob(
  jobId: string,
  sessionId: string,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  return createClient(port).stopJob(jobId, sessionId);
}

export async function loadChatServerSystemPromptPreview(
  sessionId: string,
  input: Pick<RunStartInput, "system" | "memory" | "cwd" | "workspaceId" | "toolNames">,
  port = CHAT_SERVER_DEFAULT_PORT,
) {
  const response = await chatServerRequest(
    `/v1/sessions/${encodeURIComponent(sessionId)}/system-prompt/preview`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
    port,
  );
  return (await response.json()) as SystemPromptPreview;
}

export async function chatServerFetch(input: RequestInfo | URL, init?: RequestInit, port?: number) {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const selectedPort = port ?? chatServerPort();
  return requestChatServerResponse(`${url.pathname}${url.search}`, init, selectedPort);
}

export function subscribeChatServerEvents(
  port: number,
  handlers: {
    onSnapshot?: (sessions: ChatServerSession[]) => void;
    onStatus?: (event: { sessionId: string; status: ChatServerSession["status"] }) => void;
    onDelta?: (event: {
      sessionId: string;
      runId?: string;
      messageId?: string;
      delta: string;
    }) => void;
    onMessageUpdated?: (event: { sessionId: string; runId?: string; message?: UIMessage }) => void;
    onContextCompacted?: (event: {
      sessionId: string;
      runId?: string;
      contextCompaction: ChatContextCompaction;
    }) => void;
    onContextUsage?: (event: {
      sessionId: string;
      runId?: string;
      contextUsage: ChatContextUsage;
    }) => void;
    onRunProgress?: (event: {
      sessionId: string;
      runId?: string;
      runProgress: ChatRunProgress;
    }) => void;
    onRunFinished?: (event: { sessionId: string; runSummary: ChatRunSummary }) => void;
    onPlanUpdated?: (event: {
      sessionId: string;
      planId?: string;
      planFileName?: string;
      planContent?: string;
      planUpdatedAt?: string;
    }) => void;
    onJobUpdated?: (event: { sessionId: string; job?: ChatJobSummary }) => void;
    onJobOutput?: (event: { sessionId: string; jobOutput?: ChatJobOutputPage }) => void;
    onJobDone?: (event: { sessionId: string; job?: ChatJobSummary }) => void;
  },
) {
  let closed = false;
  let cleanup: (() => void) | undefined;
  void initializeChatServer().then(() => {
    if (closed) return;
    cleanup = createClient(port).subscribeEvents({
      onSnapshot: handlers.onSnapshot,
      onStatus: (event) => {
        if (event.sessionId && event.status) {
          handlers.onStatus?.({ sessionId: event.sessionId, status: event.status });
        }
      },
      onDelta: (event) => {
        if (event.sessionId && typeof event.delta === "string") {
          handlers.onDelta?.({
            sessionId: event.sessionId,
            runId: event.runId,
            messageId: event.messageId,
            delta: event.delta,
          });
        }
      },
      onMessageUpdated: (event) => {
        if (event.sessionId) {
          handlers.onMessageUpdated?.({
            sessionId: event.sessionId,
            runId: event.runId,
            message: event.message,
          });
        }
      },
      onContextCompacted: (event) => {
        if (event.sessionId && event.contextCompaction) {
          handlers.onContextCompacted?.({
            sessionId: event.sessionId,
            runId: event.runId,
            contextCompaction: event.contextCompaction,
          });
        }
      },
      onContextUsage: (event) => {
        if (event.sessionId && event.contextUsage) {
          handlers.onContextUsage?.({
            sessionId: event.sessionId,
            runId: event.runId,
            contextUsage: event.contextUsage,
          });
        }
      },
      onRunProgress: (event) => {
        if (event.sessionId && event.runProgress) {
          handlers.onRunProgress?.({
            sessionId: event.sessionId,
            runId: event.runId,
            runProgress: event.runProgress,
          });
        }
      },
      onRunDone: (event) => {
        if (event.sessionId && event.runSummary) {
          handlers.onRunFinished?.({
            sessionId: event.sessionId,
            runSummary: event.runSummary,
          });
        }
      },
      onRunError: (event) => {
        if (event.sessionId && event.runSummary) {
          handlers.onRunFinished?.({
            sessionId: event.sessionId,
            runSummary: event.runSummary,
          });
        }
      },
      onPlanUpdated: (event) => {
        if (event.sessionId) {
          handlers.onPlanUpdated?.({
            sessionId: event.sessionId,
            planId: event.planId,
            planFileName: event.planFileName,
            planContent: event.planContent,
            planUpdatedAt: event.planUpdatedAt,
          });
        }
      },
      onJobUpdated: (event) => {
        if (event.sessionId)
          handlers.onJobUpdated?.({ sessionId: event.sessionId, job: event.job });
      },
      onJobOutput: (event) => {
        if (event.sessionId)
          handlers.onJobOutput?.({ sessionId: event.sessionId, jobOutput: event.jobOutput });
      },
      onJobDone: (event) => {
        if (event.sessionId) handlers.onJobDone?.({ sessionId: event.sessionId, job: event.job });
      },
    });
  });
  return () => {
    closed = true;
    cleanup?.();
  };
}
