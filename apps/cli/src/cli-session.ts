import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AgentCoreOptions,
  type ChatSession,
  createAgentCore,
  resolveSessionTitleModel,
} from "@chatdesk/agent-core";
import { ChatServerClient, type RunStreamResult } from "@chatdesk/chat-server-client";
import {
  CHAT_SCHEMA_VERSION,
  type ChatRunSummary,
  type ChatTokenUsage,
  deriveTitle,
  type RunStartInput,
  textFromMessage,
} from "@chatdesk/shared";

const CHAT_SERVER_RUNTIME_PROTOCOL_VERSION = 1;
type ChatServerRuntimeDescriptor = {
  protocolVersion: typeof CHAT_SERVER_RUNTIME_PROTOCOL_VERSION;
  pid: number;
  host: string;
  port: number;
  token: string;
  startedAt: string;
};

const CLI_WORKSPACE_TOOL_NAMES = [
  "list_dir",
  "search_files",
  "read_file",
  "write_file",
  "edit_file",
  "apply_patch",
  "bash",
] as const;

export const CLI_DEFAULT_TOOL_NAMES = [
  ...CLI_WORKSPACE_TOOL_NAMES,
  "web_search",
  "web_fetch",
] as const;

export type CliChatServer = {
  health(): Promise<unknown>;
  getConfig(): Promise<{ models: unknown[]; apiKeys: Record<string, string> }>;
  createSession(options: { cwd: string; source: "cli" }): Promise<{
    id: string;
    workspaceId?: string;
    cwd?: string;
  }>;
  startRunAndWait(
    sessionId: string,
    input: RunStartInput,
    options?: { signal?: AbortSignal },
  ): Promise<RunStreamResult>;
  loadSession(sessionId: string): Promise<ChatSession | null>;
  stopRun(sessionId: string): Promise<unknown>;
};

export type CliTurnResult = {
  text: string;
  modelLabel: string;
  summary?: ChatRunSummary;
  usage?: ChatTokenUsage;
  aborted: boolean;
};

export type CliSession = {
  sessionId: string;
  modelLabel: string;
  submit(prompt: string, signal?: AbortSignal): Promise<CliTurnResult>;
  stop(): Promise<void>;
  close(): Promise<void>;
};

export type OpenCliSessionOptions = {
  modelId?: string;
  cwd?: string;
  dataDir?: string;
  createLanguageModel?: AgentCoreOptions["createLanguageModel"];
  acquireLock?: boolean;
  connectServer?: (dataDir: string) => Promise<CliChatServer | null>;
};

function resolveChatServerDataDir(env = process.env, platform = process.platform) {
  const override = env.CHAT_SERVER_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  if (platform === "darwin") return path.join(os.homedir(), ".chatdesk", "chat-server");
  return path.resolve(".data", "chat-server");
}

export function lockHint(message: string) {
  if (!message.includes("数据目录已被进程")) return message;
  return `${message}\n请先退出 ChatDesk 桌面应用，或设置 CHAT_SERVER_DATA_DIR 使用其它目录。`;
}

async function readRuntimeDescriptor(dataDir: string): Promise<ChatServerRuntimeDescriptor | null> {
  try {
    const value = JSON.parse(
      await readFile(path.join(dataDir, ".chatdesk-runtime.json"), "utf8"),
    ) as Partial<ChatServerRuntimeDescriptor>;
    const port = typeof value.port === "number" ? value.port : -1;
    if (
      value.protocolVersion !== CHAT_SERVER_RUNTIME_PROTOCOL_VERSION ||
      typeof value.pid !== "number" ||
      typeof value.host !== "string" ||
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65535 ||
      typeof value.token !== "string" ||
      !value.token ||
      typeof value.startedAt !== "string"
    )
      return null;
    return value as ChatServerRuntimeDescriptor;
  } catch {
    return null;
  }
}

function resolveCliModel(
  config: { models: unknown[]; apiKeys: Record<string, string> },
  modelId?: string,
) {
  if (modelId) {
    const models = config.models.filter((item): item is Record<string, unknown> =>
      Boolean(item && typeof item === "object"),
    );
    const found = models.find((item) => item.id === modelId || item.name === modelId);
    if (!found) throw new Error(`未找到模型：${modelId}`);
  }
  const model = resolveSessionTitleModel(config, modelId);
  if (!model) {
    throw new Error(
      modelId
        ? `模型配置不完整：${modelId}`
        : "未配置可用模型。请先在 ChatDesk 桌面应用中添加模型。",
    );
  }
  return model;
}

function lastAssistant(session: ChatSession | null | undefined) {
  const messages = session?.messages ?? [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object");
}

export function runSummaryOf(session: ChatSession | null | undefined): ChatRunSummary | undefined {
  const last = lastAssistant(session);
  const metadata = last?.metadata;
  if (!isRecord(metadata) || !("runSummary" in metadata)) return undefined;
  const summary = metadata.runSummary;
  if (!isRecord(summary)) return undefined;
  return summary as ChatRunSummary;
}

export function usageOf(session: ChatSession | null | undefined): ChatTokenUsage | undefined {
  const last = lastAssistant(session);
  const metadata = last?.metadata;
  if (!isRecord(metadata) || !("usage" in metadata)) return undefined;
  const usage = metadata.usage;
  if (!isRecord(usage)) return undefined;
  return usage as ChatTokenUsage;
}

function userMessage(prompt: string) {
  return {
    id: randomUUID(),
    role: "user" as const,
    parts: [{ type: "text" as const, text: prompt }],
  };
}

function isAbortError(error: unknown, signal?: AbortSignal) {
  return (
    signal?.aborted === true ||
    (error instanceof Error && (error.name === "AbortError" || error.message.includes("aborted")))
  );
}

function turnFromSession(
  session: ChatSession | null | undefined,
  modelLabel: string,
  extra?: { summary?: ChatRunSummary; aborted?: boolean },
): CliTurnResult {
  const last = lastAssistant(session);
  return {
    text: last ? textFromMessage(last).trim() : "",
    modelLabel,
    summary: extra?.summary ?? runSummaryOf(session),
    usage: usageOf(session),
    aborted: extra?.aborted ?? false,
  };
}

async function defaultConnectServer(dataDir: string): Promise<CliChatServer | null> {
  const descriptor = await readRuntimeDescriptor(dataDir);
  if (!descriptor) return null;
  const client = new ChatServerClient({
    baseUrl: `http://${descriptor.host}:${descriptor.port}`,
    token: descriptor.token,
  });
  try {
    await client.health();
    return client;
  } catch {
    return null;
  }
}

async function openServerSession(
  client: CliChatServer,
  cwd: string,
  modelId?: string,
): Promise<CliSession> {
  const config = await client.getConfig();
  const model = resolveCliModel(config, modelId);
  const modelLabel = model.id ?? model.name;
  const session = await client.createSession({ cwd, source: "cli" });
  const sessionId = session.id;
  const runInput = (prompt: string): RunStartInput => ({
    message: userMessage(prompt),
    modelId: modelLabel,
    workspaceId: session.workspaceId,
    cwd: session.cwd ?? cwd,
    sandboxMode: "auto",
    toolNames: [...CLI_DEFAULT_TOOL_NAMES],
  });
  return {
    sessionId,
    modelLabel,
    async submit(prompt, signal) {
      try {
        const result = await client.startRunAndWait(sessionId, runInput(prompt), { signal });
        const saved = await client.loadSession(sessionId);
        const summary = result.error?.runSummary ?? result.done?.runSummary ?? runSummaryOf(saved);
        return turnFromSession(saved, modelLabel, {
          summary,
          aborted: signal?.aborted === true || summary?.outcome === "stopped",
        });
      } catch (error) {
        if (isAbortError(error, signal)) {
          await client.stopRun(sessionId).catch(() => undefined);
          const saved = await client.loadSession(sessionId).catch(() => null);
          return turnFromSession(saved, modelLabel, { aborted: true });
        }
        throw error;
      }
    },
    async stop() {
      await client.stopRun(sessionId).catch(() => undefined);
    },
    async close() {},
  };
}

async function openLocalSession(
  dataDir: string,
  cwd: string,
  options: OpenCliSessionOptions,
): Promise<CliSession> {
  const core = await createAgentCore({
    dataDir,
    acquireLock: options.acquireLock,
    createLanguageModel: options.createLanguageModel,
  });
  const model = resolveCliModel(core.chatConfig.get(), options.modelId?.trim() || undefined);
  const modelLabel = model.id ?? model.name;
  const workspace = await core.workspaces.add({ path: cwd });
  const sessionId = randomUUID();
  const now = new Date().toISOString();
  const session: ChatSession = {
    schemaVersion: CHAT_SCHEMA_VERSION,
    id: sessionId,
    title: deriveTitle([]),
    createdAt: now,
    updatedAt: now,
    source: "cli",
    workspaceId: workspace.id,
    cwd: workspace.path,
    messages: [],
    attachments: [],
  };
  await core.store.save(session);
  const runInput = (prompt: string): RunStartInput => ({
    message: userMessage(prompt),
    modelId: modelLabel,
    workspaceId: workspace.id,
    cwd: workspace.path,
    sandboxMode: "auto",
    toolNames: [...CLI_DEFAULT_TOOL_NAMES],
  });
  return {
    sessionId,
    modelLabel,
    async submit(prompt, signal) {
      const stopOnAbort = () => {
        void core.runs.stop(sessionId);
      };
      signal?.addEventListener("abort", stopOnAbort);
      try {
        if (signal?.aborted) {
          return { text: "", modelLabel, aborted: true };
        }
        await core.runs.startDetached(sessionId, runInput(prompt));
        await core.runs.waitForRun(sessionId);
        const saved = await core.store.get(sessionId);
        return turnFromSession(saved, modelLabel, { aborted: signal?.aborted === true });
      } catch (error) {
        if (isAbortError(error, signal)) {
          await core.runs.stop(sessionId).catch(() => undefined);
          const saved = await core.store.get(sessionId).catch(() => null);
          return turnFromSession(saved, modelLabel, { aborted: true });
        }
        throw error;
      } finally {
        signal?.removeEventListener("abort", stopOnAbort);
      }
    },
    async stop() {
      await core.runs.stop(sessionId).catch(() => undefined);
    },
    async close() {
      await core.shutdown();
    },
  };
}

export async function openCliSession(options: OpenCliSessionOptions): Promise<CliSession> {
  const dataDir = options.dataDir?.trim()
    ? path.resolve(options.dataDir)
    : resolveChatServerDataDir();
  const cwd = path.resolve(options.cwd?.trim() || process.cwd());
  const cwdStat = await stat(cwd).catch(() => undefined);
  if (!cwdStat?.isDirectory()) {
    throw new Error(`workspace 目录不存在：${cwd}`);
  }
  await mkdir(dataDir, { recursive: true });
  const connect = options.connectServer ?? defaultConnectServer;
  const server = await connect(dataDir);
  if (server) return openServerSession(server, cwd, options.modelId?.trim() || undefined);
  return openLocalSession(dataDir, cwd, options);
}
