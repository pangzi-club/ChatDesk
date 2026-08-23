import { randomUUID } from "node:crypto";
import { mkdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  type AgentCore,
  type AgentCoreOptions,
  type ChatSession,
  createAgentCore,
  resolveSessionTitleModel,
} from "@chatdesk/agent-core";
import {
  CHAT_SCHEMA_VERSION,
  type ChatRunSummary,
  deriveTitle,
  textFromMessage,
} from "@chatdesk/shared";

const CLI_WORKSPACE_TOOL_NAMES = [
  "list_dir",
  "search_files",
  "read_file",
  "write_file",
  "edit_file",
  "apply_patch",
  "bash",
];

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
      toolNames: [...CLI_WORKSPACE_TOOL_NAMES],
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
