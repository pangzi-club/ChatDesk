import type {
  ChatIndexItem,
  ChatServerAiUsageLog,
  ChatServerConfigData,
  ChatServerProviderModel,
  ChatServerReviewerLog,
  ChatSession,
  DeveloperEnvironmentStatus,
  HealthResponse,
  RunStartInput,
  ServerEvent,
  SessionIndexItem,
} from "@chatdesk/shared";

export type EventSourceLike = {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
  onerror: (() => void) | null;
  onopen: (() => void) | null;
};

export type EventSourceFactory = (url: string) => EventSourceLike;

export type ChatServerClientOptions = {
  baseUrl: string;
  token?: string;
  fetchImpl?: typeof fetch;
  eventSourceFactory?: EventSourceFactory;
  reconnect?: boolean;
};

export type ChatEventHandlers = {
  onSnapshot?: (sessions: SessionIndexItem[]) => void;
  onEvent?: (event: ServerEvent) => void;
  onStatus?: (event: ServerEvent & { type: "session.status" }) => void;
  onDelta?: (event: ServerEvent & { type: "message.delta" }) => void;
  onMessageUpdated?: (event: ServerEvent & { type: "message.updated" }) => void;
  onContextCompacted?: (event: ServerEvent & { type: "context.compacted" }) => void;
  onContextUsage?: (event: ServerEvent & { type: "context.usage" }) => void;
  onRunProgress?: (event: ServerEvent & { type: "run.progress" }) => void;
  onPlanUpdated?: (event: ServerEvent & { type: "plan.updated" }) => void;
};

export class ChatServerError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload?: unknown) {
    super(message);
    this.name = "ChatServerError";
    this.status = status;
    this.payload = payload;
  }
}

function defaultEventSourceFactory(url: string): EventSourceLike {
  const EventSourceConstructor = globalThis.EventSource;
  if (!EventSourceConstructor) {
    throw new Error("当前运行时不支持 EventSource");
  }
  return new EventSourceConstructor(url) as unknown as EventSourceLike;
}

function encodePath(value: string) {
  return encodeURIComponent(value);
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export class ChatServerClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  private readonly eventSourceFactory: EventSourceFactory;
  private readonly reconnect: boolean;

  constructor(options: ChatServerClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.token = options.token ?? "";
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.eventSourceFactory = options.eventSourceFactory ?? defaultEventSourceFactory;
    this.reconnect = options.reconnect ?? true;
  }

  headers(init?: HeadersInit) {
    const headers = new Headers(init);
    if (this.token) headers.set("Authorization", `Bearer ${this.token}`);
    return headers;
  }

  url(pathname: string) {
    return `${this.baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  }

  async request(pathname: string, init?: RequestInit) {
    return this.fetchImpl(this.url(pathname), {
      ...init,
      headers: this.headers(init?.headers),
    });
  }

  private async json<T>(pathname: string, init?: RequestInit, fallback = "Chat Server 请求失败") {
    const response = await this.request(pathname, init);
    const text = await response.text();
    let payload: unknown;
    try {
      payload = text ? (JSON.parse(text) as unknown) : undefined;
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const message =
        payload &&
        typeof payload === "object" &&
        typeof (payload as { error?: unknown }).error === "string"
          ? (payload as { error: string }).error
          : text || `${fallback} (${response.status})`;
      throw new ChatServerError(message, response.status, payload);
    }
    return payload as T;
  }

  health() {
    return this.json<HealthResponse>("/health", undefined, "Chat Server 健康检查失败");
  }

  listSessions() {
    return this.json<ChatIndexItem[]>("/v1/sessions", undefined, "Chat Server 会话加载失败");
  }

  createSession(options?: { id?: string; title?: string; workspaceId?: string; cwd?: string }) {
    return this.json<ChatSession>(
      "/v1/sessions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options ?? {}),
      },
      "Chat Server 会话创建失败",
    );
  }

  async loadSession<T extends ChatSession = ChatSession>(sessionId: string) {
    const response = await this.request(`/v1/sessions/${encodePath(sessionId)}`);
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new ChatServerError(
        (await response.text()) || "Chat Server 会话读取失败",
        response.status,
      );
    }
    return (await response.json()) as T;
  }

  saveSession<T extends ChatSession = ChatSession>(session: T) {
    return this.json<T>(
      `/v1/sessions/${encodePath(session.id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(session),
      },
      "Chat Server 会话保存失败",
    );
  }

  async deleteSession(sessionId: string) {
    const response = await this.request(`/v1/sessions/${encodePath(sessionId)}`, {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 404) {
      throw new ChatServerError(
        (await response.text()) || "Chat Server 会话删除失败",
        response.status,
      );
    }
  }

  uploadAttachment(sessionId: string, attachmentId: string, fileName: string, bytes: Uint8Array) {
    return this.json<{ path: string }>(
      `/v1/sessions/${encodePath(sessionId)}/attachments`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: attachmentId, fileName, base64: toBase64(bytes) }),
      },
      "Chat Server 附件上传失败",
    );
  }

  startRun(sessionId: string, input: RunStartInput) {
    return this.request(`/v1/sessions/${encodePath(sessionId)}/runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  stopRun(sessionId: string) {
    return this.json<{ stopped: boolean }>(
      `/v1/sessions/${encodePath(sessionId)}/runs/stop`,
      { method: "POST" },
      "Chat Server 停止任务失败",
    );
  }

  getConfig() {
    return this.json<ChatServerConfigData>(
      "/v1/chat-config",
      undefined,
      "Chat Server 配置加载失败",
    );
  }

  saveConfig(value: unknown) {
    return this.json<ChatServerConfigData>(
      "/v1/chat-config",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      },
      "Chat Server 配置保存失败",
    );
  }

  getDeveloperEnvironment() {
    return this.json<DeveloperEnvironmentStatus>(
      "/v1/developer-environment",
      undefined,
      "开发工具环境加载失败",
    );
  }

  importDeveloperEnvironment() {
    return this.json<DeveloperEnvironmentStatus>(
      "/v1/developer-environment/import",
      { method: "POST" },
      "开发工具环境导入失败",
    );
  }

  testModel(model: { name: string; baseUrl: string; apiKey: string; responsive?: boolean }) {
    return this.json<{ durationMs: number }>(
      "/v1/models/test",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(model),
      },
      "模型测试失败",
    );
  }

  listModels(input: { baseUrl: string; apiKey: string }) {
    return this.json<ChatServerProviderModel[]>(
      "/v1/models/list",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
      "模型列表请求失败",
    );
  }

  getReviewerLogs(sessionId?: string) {
    const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
    return this.json<ChatServerReviewerLog[]>(
      `/v1/sandbox-reviews${query}`,
      undefined,
      "沙箱审批记录加载失败",
    );
  }

  getAiUsageLogs() {
    return this.json<ChatServerAiUsageLog[]>("/v1/ai-usage", undefined, "AI 用量记录加载失败");
  }

  getMemory() {
    return this.json<unknown>("/v1/memory", undefined, "Chat Server 记忆加载失败");
  }

  saveMemory(value: unknown) {
    return this.json<unknown>(
      "/v1/memory",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      },
      "Chat Server 记忆保存失败",
    );
  }

  getSkills() {
    return this.json<unknown>("/v1/skills", undefined, "Chat Server Skills 加载失败");
  }

  getSkillSelection() {
    return this.json<string[]>("/v1/skills/selection", undefined, "Chat Server Skill 选择加载失败");
  }

  saveSkillSelection(ids: string[]) {
    return this.json<unknown>(
      "/v1/skills/selection",
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ids) },
      "Chat Server Skill 选择保存失败",
    );
  }

  getMcp() {
    return this.json<unknown>("/v1/mcp", undefined, "Chat Server MCP 加载失败");
  }

  saveMcp(value: unknown) {
    return this.json<unknown>(
      "/v1/mcp",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      },
      "Chat Server MCP 保存失败",
    );
  }

  getArchiveIndex() {
    return this.json<unknown>("/v1/archive", undefined, "Chat Server 归档加载失败");
  }

  async getArchive<T>(id: string) {
    const response = await this.request(`/v1/archive/${encodePath(id)}`);
    if (response.status === 404) return null;
    if (!response.ok)
      throw new ChatServerError((await response.text()) || "归档加载失败", response.status);
    return (await response.json()) as T;
  }

  saveArchive(value: { id: string }) {
    return this.json<unknown>(
      `/v1/archive/${encodePath(value.id)}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(value),
      },
      "归档保存失败",
    );
  }

  async deleteArchive(id: string) {
    const response = await this.request(`/v1/archive/${encodePath(id)}`, { method: "DELETE" });
    if (!response.ok)
      throw new ChatServerError((await response.text()) || "归档删除失败", response.status);
  }

  async ensureSession(
    sessionId: string,
    options?: { title?: string; workspaceId?: string; cwd?: string },
  ) {
    const existing = await this.request(`/v1/sessions/${encodePath(sessionId)}`);
    if (existing.ok) return;
    if (existing.status !== 404) {
      throw new ChatServerError(
        (await existing.text()) || "Chat Server 会话检查失败",
        existing.status,
      );
    }
    await this.createSession({ id: sessionId, ...options });
  }

  subscribeEvents(handlers: ChatEventHandlers) {
    let source: EventSourceLike | undefined;
    let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;
    let retryAttempt = 0;

    const scheduleReconnect = () => {
      if (!this.reconnect || closed || reconnectTimer) return;
      const delay = [1000, 2000, 5000][Math.min(retryAttempt, 2)];
      retryAttempt += 1;
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        void connect();
      }, delay);
    };

    const dispatch = (type: string, data: string) => {
      try {
        if (type === "snapshot") {
          handlers.onSnapshot?.(JSON.parse(data) as SessionIndexItem[]);
          return;
        }
        const event = JSON.parse(data) as ServerEvent;
        handlers.onEvent?.(event);
        if (event.type === "session.status") {
          handlers.onStatus?.(event as ServerEvent & { type: "session.status" });
        }
        if (event.type === "message.delta") {
          handlers.onDelta?.(event as ServerEvent & { type: "message.delta" });
        }
        if (event.type === "message.updated") {
          handlers.onMessageUpdated?.(event as ServerEvent & { type: "message.updated" });
        }
        if (event.type === "context.compacted") {
          handlers.onContextCompacted?.(event as ServerEvent & { type: "context.compacted" });
        }
        if (event.type === "context.usage") {
          handlers.onContextUsage?.(event as ServerEvent & { type: "context.usage" });
        }
        if (event.type === "run.progress") {
          handlers.onRunProgress?.(event as ServerEvent & { type: "run.progress" });
        }
        if (event.type === "plan.updated") {
          handlers.onPlanUpdated?.(event as ServerEvent & { type: "plan.updated" });
        }
      } catch {
        // Ignore malformed reconnect/event payloads.
      }
    };

    const connect = async () => {
      if (closed) return;
      const token = this.token ? `?token=${encodeURIComponent(this.token)}` : "";
      const next = this.eventSourceFactory(this.url(`/v1/events${token}`));
      source = next;
      next.onopen = () => {
        retryAttempt = 0;
      };
      next.onerror = () => {
        next.close();
        if (source === next) source = undefined;
        scheduleReconnect();
      };
      next.addEventListener("snapshot", (event) => dispatch("snapshot", event.data));
      for (const eventType of [
        "session.status",
        "message.delta",
        "message.updated",
        "context.compacted",
        "context.usage",
        "run.progress",
        "run.error",
        "run.done",
        "plan.updated",
      ]) {
        next.addEventListener(eventType, (event) => dispatch(eventType, event.data));
      }
    };

    void connect();
    return () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
      source = undefined;
    };
  }
}

export type {
  ChatIndexItem,
  ChatServerAiUsageLog,
  ChatServerConfigData,
  ChatServerProviderModel,
  ChatServerReviewerLog,
  ChatSession,
  HealthResponse,
  RunStartInput,
  ServerEvent,
  SessionIndexItem,
};
