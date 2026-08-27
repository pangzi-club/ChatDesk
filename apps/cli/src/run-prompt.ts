import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AgentCore,
  type AgentCoreOptions,
  type ChatSession,
  createAgentCore,
  resolveSessionTitleModel,
} from "@chatdesk/agent-core";
import { ChatServerClient } from "@chatdesk/chat-server-client";
import {
  CHAT_SCHEMA_VERSION,
  type ChatRunSummary,
  deriveTitle,
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

export type RunPromptOptions = {
  prompt: string;
  modelId?: string;
  cwd?: string;
  dataDir?: string;
  stdout?: Pick<NodeJS.WritableStream, "write">;
  stderr?: Pick<NodeJS.WritableStream, "write">;
  createLanguageModel?: AgentCoreOptions["createLanguageModel"];
  acquireLock?: boolean;
  signal?: AbortSignal;
};

function resolveChatServerDataDir(env = process.env, platform = process.platform) {
  const override = env.CHAT_SERVER_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  if (platform === "darwin") return path.join(os.homedir(), ".chatdesk", "chat-server");
  return path.resolve(".data", "chat-server");
}

function writeLine(stream: Pick<NodeJS.WritableStream, "write">, text: string) {
  stream.write(`${text}\n`);
}

function lockHint(message: string) {
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

async function runPromptViaServer(
  dataDir: string,
  prompt: string,
  modelId: string | undefined,
  cwd: string,
  stdout: Pick<NodeJS.WritableStream, "write">,
  signal?: AbortSignal,
) {
  const descriptor = await readRuntimeDescriptor(dataDir);
  if (!descriptor) return null;
  const client = new ChatServerClient({
    baseUrl: `http://${descriptor.host}:${descriptor.port}`,
    token: descriptor.token,
  });
  try {
    await client.health();
  } catch {
    return null;
  }
  let sessionId: string | undefined;
  try {
    const config = await client.getConfig();
    const model = resolveCliModel(config, modelId);
    const session = await client.createSession({ cwd, source: "cli" });
    sessionId = session.id;
    const userMessage = {
      id: randomUUID(),
      role: "user" as const,
      parts: [{ type: "text" as const, text: prompt }],
    };
    const result = await client.startRunAndWait(
      session.id,
      {
        message: userMessage,
        modelId: model.id ?? model.name,
        workspaceId: session.workspaceId,
        cwd: session.cwd,
        sandboxMode: "auto",
        toolNames: [...CLI_DEFAULT_TOOL_NAMES],
      },
      { signal },
    );
    const saved = await client.loadSession(session.id);
    const last = lastAssistant(saved);
    const text = last ? textFromMessage(last).trim() : "";
    if (text) writeLine(stdout, text);
    const outcome = result.error?.runSummary?.outcome ?? result.done?.runSummary?.outcome;
    if (result.error || outcome === "error" || outcome === "stopped" || !text) return 1;
    return 0;
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || signal?.aborted)) {
      if (sessionId) await client.stopRun(sessionId).catch(() => undefined);
      return 1;
    }
    throw error;
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

function runSummaryOf(session: ChatSession | null | undefined): ChatRunSummary | undefined {
  const last = lastAssistant(session);
  const metadata = last?.metadata;
  if (!metadata || typeof metadata !== "object" || !("runSummary" in metadata)) return undefined;
  const summary = metadata.runSummary;
  if (!summary || typeof summary !== "object") return undefined;
  return summary as ChatRunSummary;
}

export async function runPrompt(options: RunPromptOptions) {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const prompt = options.prompt.trim();
  if (!prompt) {
    writeLine(stderr, "prompt 不能为空");
    return 1;
  }

  const dataDir = options.dataDir?.trim()
    ? path.resolve(options.dataDir)
    : resolveChatServerDataDir();
  const cwd = path.resolve(options.cwd?.trim() || process.cwd());
  const cwdStat = await stat(cwd).catch(() => undefined);
  if (!cwdStat?.isDirectory()) {
    writeLine(stderr, `workspace 目录不存在：${cwd}`);
    return 1;
  }

  await mkdir(dataDir, { recursive: true });

  const attached = await runPromptViaServer(
    dataDir,
    prompt,
    options.modelId?.trim() || undefined,
    cwd,
    stdout,
    options.signal,
  );
  if (attached !== null) return attached;

  let core: AgentCore | undefined;
  let sessionId: string | undefined;
  const stopOnAbort = () => {
    if (!core || !sessionId) return;
    void core.runs.stop(sessionId);
  };
  options.signal?.addEventListener("abort", stopOnAbort);

  try {
    core = await createAgentCore({
      dataDir,
      acquireLock: options.acquireLock,
      createLanguageModel: options.createLanguageModel,
    });
    const model = resolveCliModel(core.chatConfig.get(), options.modelId?.trim() || undefined);
    const workspace = await core.workspaces.add({ path: cwd });
    sessionId = randomUUID();
    const now = new Date().toISOString();
    const userMessage = {
      id: randomUUID(),
      role: "user" as const,
      parts: [{ type: "text" as const, text: prompt }],
    };
    const session: ChatSession = {
      schemaVersion: CHAT_SCHEMA_VERSION,
      id: sessionId,
      title: deriveTitle([userMessage]),
      createdAt: now,
      updatedAt: now,
      source: "cli",
      workspaceId: workspace.id,
      cwd: workspace.path,
      messages: [],
      attachments: [],
    };
    await core.store.save(session);
    await core.runs.startDetached(sessionId, {
      message: userMessage,
      modelId: model.id ?? model.name,
      workspaceId: workspace.id,
      cwd: workspace.path,
      sandboxMode: "auto",
      toolNames: [...CLI_DEFAULT_TOOL_NAMES],
    });
    await core.runs.waitForRun(sessionId);
    const saved = await core.store.get(sessionId);
    const last = lastAssistant(saved);
    const text = last ? textFromMessage(last).trim() : "";
    if (text) writeLine(stdout, text);
    const summary = runSummaryOf(saved);
    if (summary?.outcome === "error" || summary?.outcome === "stopped") {
      if (!text) {
        writeLine(stderr, summary.stopReason ? `运行失败：${summary.stopReason}` : "运行失败");
      }
      return 1;
    }
    if (!text) {
      writeLine(stderr, "模型没有返回内容");
      return 1;
    }
    return 0;
  } catch (error) {
    const message = lockHint(error instanceof Error ? error.message : String(error));
    writeLine(stderr, message);
    return 1;
  } finally {
    options.signal?.removeEventListener("abort", stopOnAbort);
    await core?.shutdown();
  }
}
