import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  buildSessionTitlePrompt,
  buildSystemPrompt,
  type ChatSession,
  CREATE_TASK_TOOL_INSTRUCTIONS,
  compressChatImage,
  createAgentCore,
  createConfiguredLanguageModel,
  DEFAULT_WORKSPACE_ID,
  type EventHub,
  hasUserMessageText,
  importDeveloperEnvironment,
  inspectDeveloperEnvironment,
  listProviderModels,
  loadBuiltinSkillsCatalog,
  MAX_ATTACHMENT_BYTES,
  nodePlatform,
  normalizeAiUsage,
  normalizeGeneratedCommitMessage,
  normalizeGeneratedSessionTitle,
  type PlanStore,
  type RunRegistry,
  type RunStartInput,
  replaceImageFileName,
  resolveEffectiveWorkspace,
  resolveSessionTitleModel,
  resolveWorkspaceFsRoot,
  SESSION_TITLE_SYSTEM,
  type SessionStore,
  scanSkills,
  sessionTitleMaxOutputTokens,
  TODO_TOOL_INSTRUCTIONS,
  testModelConnection,
  textFromMessage,
  type WorkspaceStore,
  workspaceSearchInstructions,
} from "@chatdesk/agent-core";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ArchiveStore } from "./archive-store.ts";
import { AutomationScheduler, AutomationStore } from "./automation-store.ts";
import { ChannelStore } from "./channel-store.ts";
import type { ServerConfig } from "./config.ts";
import { chatServerCorsOrigin } from "./cors.ts";
import { FeishuChannelManager } from "./feishu-channel.ts";
import { createMockLongResponse } from "./mock-long-response.ts";
import { withSseKeepAlive } from "./sse-keepalive.ts";

const runInputSchema = z.object({
  messages: z.array(z.unknown()).optional(),
  contextMessages: z.array(z.unknown()).optional(),
  message: z.unknown().optional(),
  model: z
    .object({
      id: z.string().optional(),
      name: z.string().min(1),
      provider: z.string().optional(),
      baseUrl: z.string().url(),
      apiKey: z.string().min(1).optional(),
      responsive: z.boolean().optional(),
      supportsTools: z.boolean().optional(),
      supportsReasoning: z.boolean().optional(),
      inputContext: z.number().positive().optional(),
    })
    .optional(),
  modelId: z.string().optional(),
  system: z.string().optional(),
  memory: z.string().optional(),
  cwd: z.string().optional(),
  workspaceId: z.string().optional(),
  sandboxMode: z.enum(["ask", "auto", "full"]).optional(),
  mcpServerIds: z.array(z.string()).max(100).optional(),
  skillIds: z.array(z.string()).max(100).optional(),
  title: z.string().optional(),
  toolNames: z.array(z.string()).max(100).optional(),
  planMode: z.enum(["plan", "apply"]).optional(),
  planId: z
    .string()
    .regex(/^[a-z0-9]{8}$/)
    .optional(),
  contextCompactionStrategy: z.enum(["semantic-checkpoint", "recent-time"]).optional(),
  contextCompactionWindowMinutes: z.number().positive().max(10_080).optional(),
  mockLongResponse: z.boolean().optional(),
});

const modelTestSchema = z.object({
  name: z.string().trim().min(1),
  baseUrl: z
    .string()
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "接口地址必须是合法的 http 或 https URL",
    }),
  apiKey: z.string().min(1),
  responsive: z.boolean().optional(),
});

const modelListSchema = z.object({
  baseUrl: z
    .string()
    .url()
    .refine((value) => ["http:", "https:"].includes(new URL(value).protocol), {
      message: "接口地址必须是合法的 http 或 https URL",
    }),
  apiKey: z.string().min(1),
});

const execFileAsync = promisify(execFile);

type ArchiveImportSource = "codex" | "claude-code" | "cursor" | "kimi";

function mergeSessionMessages(current: ChatSession["messages"], incoming: unknown[]) {
  const incomingMessages: ChatSession["messages"] = [];
  for (const value of incoming) {
    if (!value || typeof value !== "object") continue;
    incomingMessages.push(value as ChatSession["messages"][number]);
  }
  const incomingById = new Map(
    incomingMessages
      .filter((message) => typeof message.id === "string" && message.id)
      .map((message) => [message.id, message] as const),
  );
  const consumedIds = new Set<string>();
  const fingerprint = (message: ChatSession["messages"][number]) => {
    const text = message.parts
      .filter((part) => part.type === "text")
      .map((part) => ("text" in part && typeof part.text === "string" ? part.text : ""))
      .join("");
    if (text) return `${message.role}:${text}`;
    const copy = { ...message } as Record<string, unknown>;
    delete copy.id;
    return JSON.stringify(copy);
  };
  const isUnstableId = (id: string | undefined) => !id?.trim() || id.startsWith("legacy-message-");
  const executionFingerprint = (message: ChatSession["messages"][number]) => {
    const usage =
      message.metadata && typeof message.metadata === "object" && "usage" in message.metadata
        ? message.metadata.usage
        : undefined;
    const providerMetadata = message.parts.map((part) =>
      "providerMetadata" in part ? (part.providerMetadata ?? null) : null,
    );
    if (usage === undefined && providerMetadata.every((value) => value === null)) return "";
    return JSON.stringify({ usage: usage ?? null, providerMetadata });
  };
  const isDuplicateAssistant = (
    left: ChatSession["messages"][number],
    right: ChatSession["messages"][number],
  ) => {
    if (left.role !== "assistant" || right.role !== "assistant") return false;
    if (fingerprint(left) !== fingerprint(right)) return false;
    if (isUnstableId(left.id) || isUnstableId(right.id)) return true;
    const leftExecution = executionFingerprint(left);
    return leftExecution !== "" && leftExecution === executionFingerprint(right);
  };
  const mergeMessages = (
    left: ChatSession["messages"][number],
    right: ChatSession["messages"][number],
  ) => {
    const preferred =
      isUnstableId(left.id) && !isUnstableId(right.id)
        ? right
        : right.parts.length > left.parts.length
          ? right
          : left;
    const merged =
      right.metadata === undefined && left.metadata !== undefined
        ? { ...preferred, metadata: left.metadata }
        : preferred;
    return merged;
  };

  const merged = current.map((message) => {
    let next = incomingById.get(message.id);
    if (next) consumedIds.add(next.id);
    if (!next && isUnstableId(message.id)) {
      next = incomingMessages.find(
        (candidate) =>
          !consumedIds.has(candidate.id) &&
          candidate.role === message.role &&
          fingerprint(candidate) === fingerprint(message),
      );
      if (next) consumedIds.add(next.id);
    }
    if (!next) {
      next = incomingMessages.find(
        (candidate) => !consumedIds.has(candidate.id) && isDuplicateAssistant(message, candidate),
      );
      if (next) consumedIds.add(next.id);
    }
    if (!next) return message;
    return mergeMessages(message, next);
  });
  for (const message of incomingMessages) {
    if (!message.id || consumedIds.has(message.id)) continue;
    const existingUnstable = merged.find(
      (candidate) =>
        isUnstableId(candidate.id) &&
        candidate.role === message.role &&
        fingerprint(candidate) === fingerprint(message),
    );
    if (existingUnstable) continue;
    const existingDuplicate = merged.find((candidate) => isDuplicateAssistant(candidate, message));
    if (existingDuplicate) {
      const index = merged.indexOf(existingDuplicate);
      merged[index] = mergeMessages(existingDuplicate, message);
      continue;
    }
    merged.push(message);
  }
  return merged;
}

function archiveRoots(source: ArchiveImportSource): string[] {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  const cursorRoots =
    process.platform === "win32"
      ? [path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "Cursor", "User")]
      : process.platform === "darwin"
        ? [path.join(home, "Library", "Application Support", "Cursor", "User")]
        : [path.join(home, ".config", "Cursor", "User")];
  if (source === "codex") return [path.join(home, ".codex")];
  if (source === "claude-code") return [path.join(home, ".claude")];
  if (source === "cursor") return cursorRoots;
  return [
    process.env.KIMI_CODE_HOME || path.join(home, ".kimi-code"),
    process.env.KIMI_SHARE_DIR || path.join(home, ".kimi"),
  ];
}

function archiveUploadRoot(dataDir: string) {
  return path.join(dataDir, "archive-uploads");
}

function sourceFileMatches(source: ArchiveImportSource, fileName: string) {
  if (source === "cursor") return fileName === "state.vscdb";
  if (source === "kimi") return fileName === "context.jsonl";
  return fileName.toLowerCase().endsWith(".jsonl");
}

async function scanArchiveSource(source: ArchiveImportSource) {
  const results: Array<Record<string, unknown>> = [];
  const walk = async (directory: string, root: string): Promise<void> => {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await walk(target, root);
      } else if (entry.isFile() && sourceFileMatches(source, entry.name)) {
        const metadata = await stat(target).catch(() => null);
        const relativePath = path.relative(root, target);
        results.push({
          source,
          externalId:
            source === "codex" || source === "claude-code"
              ? relativePath.replace(/\.jsonl$/i, "")
              : relativePath,
          sourcePath: target,
          updatedAt: metadata?.mtime.toISOString(),
          size: metadata?.size ?? 0,
        });
      }
    }
  };
  for (const root of archiveRoots(source)) await walk(root, root);
  return results;
}

function jsonError(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestCwd(query?: string, body?: unknown) {
  if (typeof body === "object" && body && "cwd" in body && typeof body.cwd === "string") {
    const cwd = body.cwd.trim();
    if (cwd) return cwd;
  }
  return query?.trim() || undefined;
}

async function workspaceFsRoot(store: WorkspaceStore, id: string, cwd?: string) {
  const workspace = store.get(id);
  if (!workspace) return { error: jsonError("workspace 不存在", 404) };
  try {
    const root = resolveWorkspaceFsRoot(workspace.path, cwd);
    if (cwd && workspace.id === DEFAULT_WORKSPACE_ID) {
      await mkdir(root, { recursive: true });
    }
    return { root };
  } catch (error) {
    return { error: jsonError(error instanceof Error ? error.message : String(error)) };
  }
}

function parseJson<T>(value: unknown, schema: z.ZodType<T>): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message || "请求参数无效");
  return parsed.data;
}

function emptySession(id = randomUUID()): ChatSession {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    id,
    title: "新对话",
    createdAt: now,
    updatedAt: now,
    messages: [],
    attachments: [],
  };
}

function remapForkValue(
  value: unknown,
  maps: {
    attachments: Map<string, string>;
    plans: Map<string, string>;
    tools: Map<string, string>;
    approvals: Map<string, string>;
  },
  parentKey?: string,
): unknown {
  if (Array.isArray(value)) return value.map((item) => remapForkValue(item, maps, parentKey));
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const map =
      key === "attachmentId"
        ? maps.attachments
        : key === "planId"
          ? maps.plans
          : key === "toolCallId"
            ? maps.tools
            : key === "id" && parentKey === "approval"
              ? maps.approvals
              : undefined;
    if (map && typeof child === "string") {
      if (!map.has(child)) map.set(child, randomUUID());
      output[key] = map.get(child);
    } else {
      output[key] = remapForkValue(child, maps, key);
    }
  }
  return output;
}

async function forkSession(
  source: ChatSession,
  messageId: string,
  store: SessionStore,
  plans: PlanStore,
) {
  const messageIndex = source.messages.findIndex((message) => message.id === messageId);
  const selected = source.messages[messageIndex];
  if (selected?.role !== "assistant") throw new Error("只能从 bot 回复创建对话分支");

  const targetId = randomUUID();
  const now = new Date().toISOString();
  const maps = {
    attachments: new Map<string, string>(),
    plans: new Map<string, string>(),
    tools: new Map<string, string>(),
    approvals: new Map<string, string>(),
  };
  const attachments: ChatSession["attachments"] = [];
  try {
    for (const attachment of source.attachments) {
      const nextId = randomUUID();
      maps.attachments.set(attachment.id, nextId);
      const stored = await store.readAttachment(source.id, attachment.id);
      if (!stored) {
        if (attachment.source !== "remote")
          throw new Error(`附件不存在：${attachment.fileName ?? attachment.id}`);
        attachments.push({ ...attachment, id: nextId });
        continue;
      }
      const path = await store.saveAttachment(targetId, nextId, stored.name, stored.bytes);
      attachments.push({
        ...attachment,
        id: nextId,
        path,
        fileName: attachment.fileName ?? stored.name,
      });
    }

    await store.save({
      ...source,
      id: targetId,
      title: `Fork-${source.title}`,
      createdAt: now,
      updatedAt: now,
      messages: [],
      attachments,
      plans: [],
      activePlanId: undefined,
    });

    const sourcePlans = await plans.list(source.id);
    const clonedPlans: ChatSession["plans"] = [];
    for (const summary of sourcePlans) {
      const content = await plans.read(source.id, summary.id);
      const cloned = await plans.create(targetId);
      await plans.write(targetId, cloned.id, content.content);
      maps.plans.set(summary.id, cloned.id);
      clonedPlans.push(cloned);
    }

    const messages = source.messages.slice(0, messageIndex + 1).map((message) => {
      const nextId = randomUUID();
      const cloned = remapForkValue(message, maps) as ChatSession["messages"][number];
      return { ...cloned, id: nextId };
    });
    const target: ChatSession = {
      ...source,
      schemaVersion: 2,
      id: targetId,
      title: `Fork-${source.title}`,
      createdAt: now,
      updatedAt: now,
      messages,
      attachments,
      plans: clonedPlans,
      activePlanId: source.activePlanId ? maps.plans.get(source.activePlanId) : undefined,
    };
    await store.save(target);
    return target;
  } catch (error) {
    await store.delete(targetId).catch(() => undefined);
    throw error;
  }
}

export type ChatServer = {
  app: Hono;
  store: SessionStore;
  events: EventHub;
  runs: RunRegistry;
  plans: PlanStore;
  config: ServerConfig;
  shutdown: () => Promise<void>;
};

export async function createChatServer(config: ServerConfig): Promise<ChatServer> {
  const core = await createAgentCore({ dataDir: config.dataDir, acquireLock: false });
  const {
    store,
    events,
    runs,
    plans,
    jobs,
    chatConfig,
    memory,
    workspaces,
    mcp,
    activityLogs,
    aiUsageLogs,
    imageGeneration,
  } = core;
  const archive = new ArchiveStore(config.dataDir);
  await archive.init();
  await activityLogs.append({
    level: "info",
    source: "Chat Server",
    message: "Chat Server 已启动",
  });
  const automations = new AutomationStore(config.dataDir);
  const channels = new ChannelStore(config.dataDir);
  let feishu!: FeishuChannelManager;
  feishu = new FeishuChannelManager(
    channels,
    events,
    async (item) => {
      let sessionId = await channels.getSessionId(item.contactId);
      if (!sessionId || !(await store.get(sessionId))) {
        const session = emptySession();
        sessionId = session.id;
        await store.save({ ...session, title: item.senderName || "飞书对话", source: "feishu" });
        await channels.setSessionId(item.contactId, sessionId);
      }
      const userMessage = {
        id: `feishu-${item.id}`,
        role: "user" as const,
        parts: [{ type: "text" as const, text: item.text }],
      };
      try {
        const channelConfig = await channels.getConfig();
        const agent = channelConfig?.agentId
          ? chatConfig.get().agents.find((item) => item.id === channelConfig.agentId)
          : undefined;
        if (!agent) throw new Error("Channel 未绑定有效的 Agent");
        const response = await runs.start(sessionId, {
          message: userMessage,
          modelId: agent.modelId,
          system: agent.systemPrompt || undefined,
          mcpServerIds: agent.mcpServerIds,
          skillIds: agent.skillIds,
          toolNames: agent.toolPackIds,
          planMode: "apply",
        });
        if (response.body) await response.body.pipeTo(new WritableStream({ write() {} }));
        await runs.waitForRun(sessionId);
        const session = await store.get(sessionId);
        const reply = session?.messages
          .slice()
          .reverse()
          .find((message) => message.role === "assistant");
        const text = reply ? textFromMessage(reply) : "";
        await feishu.sendText(item.contactId, text || "暂时无法生成回复，请稍后重试。");
      } catch (error) {
        await activityLogs.append({
          level: "error",
          source: "飞书自动回复",
          message: error instanceof Error ? error.message : String(error),
        });
        await feishu.sendText(item.contactId, "暂时无法回复，请稍后重试。").catch(() => undefined);
      }
    },
    (id) => chatConfig.get().agents.find((item) => item.id === id),
    (message) =>
      activityLogs
        .append({ level: "warning", source: "飞书联系人资料", message })
        .then(() => undefined),
  );
  await feishu.start();
  await automations.init();
  const automationScheduler = new AutomationScheduler(automations, (task, message) =>
    activityLogs
      .append({
        level: "info",
        source: `自动化 · ${task.name}`,
        message,
      })
      .then(() => undefined),
  );
  automationScheduler.start();
  const app = new Hono();

  app.use("*", async (c, next) => {
    await next();
    if (c.req.header("Access-Control-Request-Private-Network") !== "true") return;
    if (!chatServerCorsOrigin(c.req.header("origin") || "")) return;
    c.res.headers.set("Access-Control-Allow-Private-Network", "true");
  });
  app.use(
    "*",
    cors({
      origin: chatServerCorsOrigin,
      allowHeaders: ["Authorization", "Content-Type", "Accept"],
      allowMethods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );
  app.use("*", async (c, next) => {
    if (c.req.method === "OPTIONS" || c.req.path === "/health") return next();
    if (!config.token) return next();
    const authorization = c.req.header("Authorization");
    const queryToken = c.req.query("token");
    if (authorization !== `Bearer ${config.token}` && queryToken !== config.token) {
      return c.json({ error: "Unauthorized" }, 401);
    }
    return next();
  });

  app.get("/health", (c) =>
    c.json({
      ok: true,
      host: config.host,
      port: config.port,
      version: config.version,
      activeRuns: runs.activeCount(),
    }),
  );

  app.get("/v1/platform/capabilities", (c) => c.json(nodePlatform.capabilities()));

  app.get("/v1/channels/feishu/config", async (c) => {
    const value = await channels.getConfig();
    const agent = value?.agentId
      ? chatConfig.get().agents.find((item) => item.id === value.agentId)
      : undefined;
    return c.json(
      feishu.getStatus().configured
        ? {
            ...feishu.getStatus(),
            name: value?.name || "飞书",
            appId: value?.appId,
            agentId: value?.agentId,
            agentName: agent?.name,
            agentAvatar: agent?.avatar,
            agentValid: Boolean(agent),
            needsAgent: !agent,
          }
        : {
            ...feishu.getStatus(),
            configured: Boolean(value),
            name: value?.name || "飞书",
            appId: value?.appId,
            agentId: value?.agentId,
          },
    );
  });
  app.put("/v1/channels/feishu/config", async (c) => {
    const body = (await c.req.json()) as {
      name?: unknown;
      appId?: unknown;
      appSecret?: unknown;
      agentId?: unknown;
    };
    const existing = await channels.getConfig();
    const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
    if (
      typeof body.name !== "string" ||
      !body.name.trim() ||
      body.name.trim().length > 80 ||
      typeof body.appId !== "string" ||
      !body.appId.trim() ||
      (typeof body.appSecret !== "string" && body.appSecret !== undefined) ||
      (body.appSecret === undefined && !existing?.appSecret) ||
      (typeof body.appSecret === "string" && !body.appSecret.trim() && !existing?.appSecret) ||
      typeof body.agentId !== "string" ||
      !agentId ||
      !chatConfig.get().agents.some((agent) => agent.id === agentId)
    ) {
      return jsonError("Channel 名称、App ID、App Secret 和有效 Agent 不能为空", 400);
    }
    await feishu.saveConfig({
      name: body.name.trim(),
      appId: body.appId.trim(),
      appSecret:
        typeof body.appSecret === "string" && body.appSecret.trim()
          ? body.appSecret.trim()
          : existing?.appSecret || "",
      agentId,
    });
    return c.json(feishu.getStatus());
  });
  app.delete("/v1/channels/feishu/config", async (c) => {
    await feishu.clearConfig();
    return c.json(feishu.getStatus());
  });
  app.post("/v1/channels/feishu/test", async (c) => {
    const value = await channels.getConfig();
    if (!value) return jsonError("尚未配置飞书账户", 400);
    return c.json(feishu.getStatus());
  });
  app.get("/v1/channels/feishu/contacts", async (c) => c.json(await channels.listContacts()));
  app.get("/v1/channels/feishu/unread", async (c) => c.json(await channels.listUnread()));
  app.get("/v1/channels/feishu/contacts/:contactId/messages", async (c) =>
    c.json(await channels.listMessages(c.req.param("contactId"))),
  );
  app.post("/v1/channels/feishu/contacts/:contactId/read", async (c) => {
    await channels.markRead(c.req.param("contactId"));
    return c.json({ ok: true });
  });
  app.post("/v1/channels/feishu/contacts/:contactId/messages", async (c) => {
    const body = (await c.req.json()) as { text?: unknown };
    if (typeof body.text !== "string" || !body.text.trim()) return jsonError("消息不能为空", 400);
    try {
      const message = await feishu.sendText(c.req.param("contactId"), body.text.trim());
      return c.json({ ok: true, message });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 502);
    }
  });
  app.get("/v1/platform/file", async (c) => {
    const requested = c.req.query("path") || "";
    try {
      const resolved = await realpath(path.resolve(requested));
      const allowedRoots = await Promise.all(
        [config.dataDir, ...workspaces.list().map((item) => item.path)].map((root) =>
          realpath(root),
        ),
      );
      if (
        !allowedRoots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))
      ) {
        return jsonError("文件路径不在允许范围内", 403);
      }
      const bytes = await readFile(resolved);
      const mediaType = resolved.toLowerCase().endsWith(".png")
        ? "image/png"
        : resolved.toLowerCase().endsWith(".jpg") || resolved.toLowerCase().endsWith(".jpeg")
          ? "image/jpeg"
          : resolved.toLowerCase().endsWith(".webp")
            ? "image/webp"
            : "application/octet-stream";
      return new Response(bytes, {
        headers: { "Content-Type": mediaType, "Cache-Control": "private, max-age=60" },
      });
    } catch {
      return jsonError("文件不存在", 404);
    }
  });

  app.get("/v1/workspaces", (c) => c.json(workspaces.list()));
  app.post("/v1/workspaces", async (c) => {
    try {
      const body = await c.req.json();
      const rawPath = typeof body.path === "string" ? body.path : "";
      const resolvedPath = nodePlatform.resolveWorkspace(rawPath);
      const workspace = await workspaces.add({
        path: resolvedPath,
        name: typeof body.name === "string" ? body.name : undefined,
      });
      await activityLogs.append({
        level: "info",
        source: "Workspace",
        message: `已添加 ${workspace.name}`,
      });
      return c.json(workspace, 201);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.delete("/v1/workspaces/:id", async (c) => {
    const workspace = workspaces.get(c.req.param("id"));
    if (!workspace) return jsonError("workspace 不存在", 404);
    try {
      await workspaces.remove(workspace.id);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 400);
    }
    await activityLogs.append({
      level: "info",
      source: "Workspace",
      message: `已移除 ${workspace.name}`,
    });
    return c.body(null, 204);
  });
  app.get("/v1/workspaces/:id/git", async (c) => {
    const resolved = await workspaceFsRoot(
      workspaces,
      c.req.param("id"),
      requestCwd(c.req.query("cwd")),
    );
    if ("error" in resolved) return resolved.error;
    try {
      return c.json(await nodePlatform.inspectGit(resolved.root));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.get("/v1/workspaces/:id/git/diff", async (c) => {
    const resolved = await workspaceFsRoot(
      workspaces,
      c.req.param("id"),
      requestCwd(c.req.query("cwd")),
    );
    if ("error" in resolved) return resolved.error;
    try {
      const filePath = c.req.query("path") || "";
      return c.json(await nodePlatform.readGitDiff(resolved.root, filePath));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/workspaces/:id/git/restore", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const resolved = await workspaceFsRoot(
        workspaces,
        c.req.param("id"),
        requestCwd(c.req.query("cwd"), body),
      );
      if ("error" in resolved) return resolved.error;
      const filePath = typeof body.path === "string" ? body.path : undefined;
      await nodePlatform.restoreGit(resolved.root, filePath);
      return c.body(null, 204);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/workspaces/:id/git/commit", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const resolved = await workspaceFsRoot(
        workspaces,
        c.req.param("id"),
        requestCwd(c.req.query("cwd"), body),
      );
      if ("error" in resolved) return resolved.error;
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const push = body.push === true;
      let finalMessage = message;
      let generated = false;
      if (!finalMessage) {
        const config = chatConfig.get();
        const model = (config.models.find((item) => {
          if (!item || typeof item !== "object") return false;
          const value = item as { isDefault?: unknown; id?: unknown };
          return value.isDefault === true || value.id === config.approvalReviewerModelId;
        }) ?? config.models.find((item) => item && typeof item === "object")) as
          | {
              name?: string;
              baseUrl?: string;
              apiKey?: string;
              responsive?: boolean;
              provider?: string;
              id?: string;
            }
          | undefined;
        const apiKey = model?.apiKey || (model?.id ? config.apiKeys[model.id] : undefined);
        if (!model?.name || !model.baseUrl || !apiKey) {
          return jsonError("未配置可用模型，请填写提交信息后重试");
        }
        const diff = await nodePlatform.runShell(
          resolved.root,
          "git diff HEAD --stat && git diff HEAD",
          "full",
        );
        if (diff.code !== 0) return jsonError(diff.out || "读取 Git 改动失败");
        const { generateText } = await import("ai");
        const result = await generateText({
          model: createConfiguredLanguageModel({
            name: model.name,
            baseUrl: model.baseUrl,
            apiKey,
            provider: model.provider,
            responsive: model.responsive,
          }),
          system:
            "You write concise English Conventional Commits messages. Return exactly one line starting with one of feat:, fix:, docs:, refactor:, test:, chore:, build:, ci:, or perf:. Do not use quotes or explanations.",
          prompt: `Summarize the following Git changes as one commit message:\n\n${diff.out.slice(0, 120_000)}`,
          maxOutputTokens: 80,
          maxRetries: 0,
        });
        const usage = normalizeAiUsage(result.usage);
        if (usage) {
          await aiUsageLogs.append({
            operation: "git-commit-message",
            modelId: model.id || model.name,
            provider: model.provider,
            model: model.name,
            usage,
          });
        }
        finalMessage = normalizeGeneratedCommitMessage(result.text);
        generated = true;
      }
      const result = await nodePlatform.commitGit(resolved.root, finalMessage, push);
      return c.json({ ...result, generated });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/workspaces/:id/git/push", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const resolved = await workspaceFsRoot(
      workspaces,
      c.req.param("id"),
      requestCwd(c.req.query("cwd"), body),
    );
    if ("error" in resolved) return resolved.error;
    try {
      return c.json(await nodePlatform.pushGit(resolved.root));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.get("/v1/workspaces/:id/files", async (c) => {
    const resolved = await workspaceFsRoot(
      workspaces,
      c.req.param("id"),
      requestCwd(c.req.query("cwd")),
    );
    if ("error" in resolved) return resolved.error;
    try {
      return c.json(await nodePlatform.listDir(resolved.root, c.req.query("path") || "."));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/workspaces/:id/file", async (c) => {
    try {
      const body = await c.req.json();
      const resolved = await workspaceFsRoot(
        workspaces,
        c.req.param("id"),
        requestCwd(c.req.query("cwd"), body),
      );
      if ("error" in resolved) return resolved.error;
      const action = typeof body.action === "string" ? body.action : "read";
      const filePath = typeof body.path === "string" ? body.path : "";
      if (action === "read") return c.json(await nodePlatform.readFile(resolved.root, filePath));
      if (action === "write") {
        const result = await nodePlatform.writeFile(
          resolved.root,
          filePath,
          String(body.content ?? ""),
        );
        return c.json(result);
      }
      if (action === "edit") {
        return c.json(
          await nodePlatform.editFile(
            resolved.root,
            filePath,
            String(body.oldText ?? ""),
            String(body.newText ?? ""),
          ),
        );
      }
      return jsonError("不支持的文件操作", 400);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/workspaces/:id/search", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const resolved = await workspaceFsRoot(
        workspaces,
        c.req.param("id"),
        requestCwd(c.req.query("cwd"), body),
      );
      if ("error" in resolved) return resolved.error;
      return c.json(await nodePlatform.searchFiles(resolved.root, body));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/workspaces/:id/path-suggestions", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const resolved = await workspaceFsRoot(
        workspaces,
        c.req.param("id"),
        requestCwd(c.req.query("cwd"), body),
      );
      if ("error" in resolved) return resolved.error;
      const query = typeof body.query === "string" ? body.query : "";
      const maxResults = typeof body.maxResults === "number" ? body.maxResults : 20;
      return c.json(await nodePlatform.suggestWorkspacePaths(resolved.root, query, maxResults));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/workspaces/:id/shell", async (c) => {
    try {
      const body = await c.req.json();
      const resolved = await workspaceFsRoot(
        workspaces,
        c.req.param("id"),
        requestCwd(c.req.query("cwd")),
      );
      if ("error" in resolved) return resolved.error;
      const mode = body.mode === "full" || body.mode === "auto" ? body.mode : "ask";
      return c.json(
        await nodePlatform.runShell(
          resolved.root,
          String(body.command ?? ""),
          mode,
          typeof body.cwd === "string" ? body.cwd : undefined,
          body.allowOutside === true,
          chatConfig.get().developerToolPaths,
        ),
      );
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/v1/processes/vite", async (c) => {
    try {
      return c.json(await nodePlatform.listViteProcesses());
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/processes/vite/:pid/terminate", async (c) => {
    try {
      await nodePlatform.killViteProcess(Number(c.req.param("pid")));
      return c.body(null, 204);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/v1/automations", (c) => c.json(automations.list()));
  app.put("/v1/automations", async (c) => {
    try {
      const next = await automations.replace(await c.req.json());
      return c.json(next);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/automations/:id/run", async (c) => {
    try {
      await automationScheduler.runNow(c.req.param("id"));
      return c.body(null, 204);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.delete("/v1/automations/:id", async (c) => {
    return c.json(await automations.remove(c.req.param("id")));
  });

  app.get("/v1/activity-logs", (c) => c.json(activityLogs.list()));
  app.post("/v1/activity-logs", async (c) => {
    try {
      const body = await c.req.json();
      return c.json(await activityLogs.append(body), 201);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.delete("/v1/activity-logs", async (c) => {
    await activityLogs.clear();
    return c.body(null, 204);
  });

  app.get("/v1/jobs", async (c) => {
    const sessionId = c.req.query("sessionId");
    if (!sessionId) return jsonError("缺少 sessionId", 400);
    return c.json(await jobs.list(sessionId));
  });
  app.get("/v1/jobs/:id", async (c) => {
    try {
      const sessionId = c.req.query("sessionId") || c.req.header("X-ChatDesk-Session-Id") || "";
      return c.json(await jobs.get(c.req.param("id"), sessionId));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 404);
    }
  });
  app.get("/v1/jobs/:id/output", async (c) => {
    try {
      const sessionId = c.req.query("sessionId") || c.req.header("X-ChatDesk-Session-Id") || "";
      const cursor = Number(c.req.query("cursor") || 0);
      return c.json(
        jobs.output(c.req.param("id"), sessionId, Number.isFinite(cursor) ? cursor : 0),
      );
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 404);
    }
  });
  app.post("/v1/jobs/:id/wait", async (c) => {
    try {
      const sessionId = c.req.query("sessionId") || c.req.header("X-ChatDesk-Session-Id") || "";
      const body = (await c.req.json().catch(() => ({}))) as { timeoutMs?: number };
      return c.json(await jobs.wait(c.req.param("id"), sessionId, Number(body.timeoutMs) || 0));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 404);
    }
  });
  app.post("/v1/jobs/:id/stop", async (c) => {
    try {
      const sessionId = c.req.query("sessionId") || c.req.header("X-ChatDesk-Session-Id") || "";
      return c.json(await jobs.stop(c.req.param("id"), sessionId));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 404);
    }
  });
  app.get("/v1/image-generation", (c) => c.json(imageGeneration.list()));
  app.post("/v1/image-generation", async (c) => {
    try {
      const result = await imageGeneration.save(await c.req.json());
      await activityLogs.append({
        level: "success",
        source: "图片生成",
        message: "图片生成记录已保存",
      });
      return c.json(result, 201);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.delete("/v1/image-generation", async (c) => {
    await imageGeneration.clear();
    return c.body(null, 204);
  });

  app.get("/v1/config", (c) =>
    c.json({ host: config.host, port: config.port, restartRequired: false }),
  );
  app.patch("/v1/config", async (c) => {
    try {
      const body = await c.req.json();
      const port = parseJson(body, z.object({ port: z.number().int().min(1024).max(65535) })).port;
      const { savePendingPort } = await import("./config.ts");
      await savePendingPort(config.dataDir, port);
      return c.json({ host: config.host, port, restartRequired: port !== config.port });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/v1/chat-config", (c) => c.json(chatConfig.get()));
  app.get("/v1/developer-environment", async (c) => {
    try {
      return c.json(await inspectDeveloperEnvironment(chatConfig.get().developerToolPaths));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/developer-environment/import", async (c) => {
    try {
      return c.json(await importDeveloperEnvironment());
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.get("/v1/ai-usage", (c) => c.json(aiUsageLogs.list()));
  app.get("/v1/sandbox-reviews", (c) => c.json(runs.reviewLogs(c.req.query("sessionId"))));
  app.patch("/v1/chat-config", async (c) => {
    try {
      const body = await c.req.json();
      const current = chatConfig.get();
      const nextAgents =
        body && typeof body === "object" && Array.isArray(body.agents)
          ? body.agents
          : current.agents;
      const boundAgentId = (await channels.getConfig())?.agentId;
      if (
        boundAgentId &&
        nextAgents.every(
          (agent: unknown) =>
            agent && typeof agent === "object" && (agent as { id?: unknown }).id !== boundAgentId,
        )
      ) {
        return jsonError("该 Agent 已被 Channel 绑定，请先更换 Channel 的 Agent", 400);
      }
      return c.json(await chatConfig.update(body));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/v1/models/test", async (c) => {
    let model: z.infer<typeof modelTestSchema>;
    try {
      model = parseJson(await c.req.json(), modelTestSchema);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
    try {
      return c.json(await testModelConnection(model));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 502);
    }
  });

  app.post("/v1/models/list", async (c) => {
    let input: z.infer<typeof modelListSchema>;
    try {
      input = parseJson(await c.req.json(), modelListSchema);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
    try {
      return c.json(await listProviderModels(input));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 502);
    }
  });

  app.get("/v1/memory", (c) => c.json(memory.get()));
  app.put("/v1/memory", async (c) => {
    try {
      return c.json(await memory.save(await c.req.json()));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/v1/skills", async (c) => c.json(await scanSkills()));
  app.get("/v1/skills/selection", (c) => c.json(chatConfig.get().selectedSkillIds));
  app.put("/v1/skills/selection", async (c) => {
    try {
      const body = await c.req.json();
      return c.json(await chatConfig.update({ selectedSkillIds: body }));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.get("/v1/mcp", (c) => c.json(chatConfig.get().mcpServers));
  app.put("/v1/mcp", async (c) => {
    try {
      return c.json(await chatConfig.update({ mcpServers: await c.req.json() }));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/mcp/start", async (c) => {
    try {
      const input = await c.req.json();
      await mcp.start(input);
      await activityLogs.append({ level: "info", source: "MCP", message: "MCP 服务已启动" });
      return c.body(null, 204);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/mcp/test", async (c) => {
    try {
      const result = await mcp.test(await c.req.json());
      await activityLogs.append({ level: "success", source: "MCP", message: "MCP 测试完成" });
      return c.json(result);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.get("/v1/mcp/:id/tools", async (c) => {
    try {
      return c.json(await mcp.listTools(c.req.param("id")));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/mcp/:id/call", async (c) => {
    try {
      const body = await c.req.json();
      const result = await mcp.callTool(c.req.param("id"), body.toolName, body.arguments);
      await activityLogs.append({
        level: "info",
        source: "MCP",
        message: `已调用工具 ${String(body.toolName || "unknown")}`,
      });
      return c.json(result);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/mcp/:id/stop", async (c) => {
    await mcp.stop(c.req.param("id"));
    await activityLogs.append({ level: "info", source: "MCP", message: "MCP 服务已停止" });
    return c.body(null, 204);
  });

  app.get("/v1/archive", async (c) => c.json(await archive.list()));
  app.get("/v1/archive/:id", async (c) => {
    const value = await archive.get(c.req.param("id"));
    return value ? c.json(value) : jsonError("归档不存在", 404);
  });
  app.put("/v1/archive/:id", async (c) => {
    try {
      const body = await c.req.json();
      const id = c.req.param("id");
      const overwritten = Boolean(await archive.get(id));
      await archive.save({ ...body, id });
      return c.json({ id, overwritten });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.delete("/v1/archive/:id", async (c) => {
    await archive.delete(c.req.param("id"));
    return c.body(null, 204);
  });
  app.post("/v1/archive/scan/:source", async (c) => {
    const source = c.req.param("source") as ArchiveImportSource;
    if (!["codex", "claude-code", "cursor", "kimi"].includes(source)) {
      return jsonError("不支持的归档来源", 400);
    }
    return c.json(await scanArchiveSource(source));
  });
  app.post("/v1/archive/upload", async (c) => {
    try {
      const form = await c.req.formData();
      const source = form.get("source");
      const file = form.get("file");
      if (
        typeof source !== "string" ||
        !["codex", "claude-code", "cursor", "kimi"].includes(source) ||
        !(file instanceof File)
      ) {
        return jsonError("归档来源或文件无效");
      }
      if (file.size > 50 * 1024 * 1024) return jsonError("归档文件不能超过 50 MB");
      const safeName = path.basename(file.name || "archive").replace(/[^\w.-]+/g, "_");
      const directory = path.join(archiveUploadRoot(config.dataDir), source);
      await mkdir(directory, { recursive: true });
      const target = path.join(directory, `${randomUUID()}-${safeName || "archive"}`);
      await writeFile(target, new Uint8Array(await file.arrayBuffer()));
      return c.json({ source, sourcePath: target, size: file.size, fileName: safeName }, 201);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/archive/read-file", async (c) => {
    try {
      const body = await c.req.json();
      const requested = typeof body.path === "string" ? body.path : "";
      const roots = [
        ...new Set([
          ...archiveRoots("codex"),
          ...archiveRoots("claude-code"),
          ...archiveRoots("kimi"),
          archiveUploadRoot(config.dataDir),
        ]),
      ];
      const resolved = path.resolve(requested);
      if (!roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
        return jsonError("path is outside allowed import roots", 403);
      }
      const { readFile } = await import("node:fs/promises");
      return c.text(await readFile(resolved, "utf8"));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/archive/read-cursor", async (c) => {
    try {
      const body = await c.req.json();
      const requested = typeof body.path === "string" ? body.path : "";
      const roots = [...archiveRoots("cursor"), archiveUploadRoot(config.dataDir)];
      const resolved = path.resolve(requested);
      if (!roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
        return jsonError("path is outside allowed import roots", 403);
      }
      const { stdout: tables } = await execFileAsync(
        "sqlite3",
        ["-readonly", resolved, ".tables"],
        {
          maxBuffer: 1024 * 1024,
        },
      );
      const table = tables.split(/\s+/).includes("ItemTable")
        ? "ItemTable"
        : tables.split(/\s+/).includes("cursorDiskKV")
          ? "cursorDiskKV"
          : null;
      if (!table) return c.text("[]");
      const { stdout } = await execFileAsync(
        "sqlite3",
        ["-readonly", "-json", resolved, `SELECT key, value FROM ${table};`],
        { maxBuffer: 64 * 1024 * 1024 },
      );
      return c.text(stdout);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/archive/path-exists", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const requested = typeof body.path === "string" ? body.path : "";
    const roots = [
      path.join(process.env.HOME || "", ".codex"),
      path.join(process.env.HOME || "", ".claude"),
    ];
    const resolved = path.resolve(requested);
    const allowed = roots.some(
      (root) => resolved === root || resolved.startsWith(`${root}${path.sep}`),
    );
    if (!allowed) return c.json({ exists: false });
    const { access } = await import("node:fs/promises");
    try {
      await access(resolved);
      return c.json({ exists: true });
    } catch {
      return c.json({ exists: false });
    }
  });

  app.get("/v1/sessions", async (c) => {
    const query = c.req.query("query") ?? "";
    const rawLimit = Number(c.req.query("limit"));
    const limit = Number.isFinite(rawLimit) ? rawLimit : undefined;
    return c.json(await store.list(runs.statusMap(), runs.runStartedAtMap(), { query, limit }));
  });

  app.post("/v1/sessions", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const requestedWorkspaceId =
        typeof body.workspaceId === "string" ? body.workspaceId.trim() : "";
      const requestedCwd = typeof body.cwd === "string" ? body.cwd : undefined;
      if (requestedWorkspaceId && !workspaces.get(requestedWorkspaceId)) {
        return jsonError("workspace 不存在", 400);
      }
      const session = emptySession(typeof body.id === "string" ? body.id : undefined);
      const bound = await workspaces.bindSession(
        session.id,
        requestedWorkspaceId || undefined,
        requestedCwd,
      );
      const next: ChatSession = {
        ...session,
        kind:
          body.kind === "ephemeral" || body.kind === "task" || body.kind === "chat"
            ? body.kind
            : undefined,
        source: body.source === "cli" ? "cli" : undefined,
        title:
          typeof body.title === "string" && body.title.trim() ? body.title.trim() : session.title,
        workspaceId: bound.workspaceId,
        cwd: bound.cwd,
      };
      await store.save(next);
      events.publish({ type: "session.status", sessionId: next.id, status: "idle" });
      return c.json(next, 201);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/v1/sessions/:id/fork", async (c) => {
    try {
      const source = await store.get(c.req.param("id"));
      if (!source) return jsonError("会话不存在", 404);
      const body = parseJson(
        await c.req.json().catch(() => ({})),
        z.object({ messageId: z.string().min(1) }),
      );
      const target = await forkSession(source, body.messageId, store, plans);
      events.publish({ type: "session.status", sessionId: target.id, status: "idle" });
      return c.json(target, 201);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.post("/v1/sessions/import", async (c) => {
    try {
      const payload = await c.req.json();
      const sessions = parseJson(
        payload,
        z.object({ sessions: z.array(z.unknown()).max(1000) }),
      ).sessions;
      let imported = 0;
      for (const value of sessions) {
        if (
          !value ||
          typeof value !== "object" ||
          typeof (value as { id?: unknown }).id !== "string"
        )
          continue;
        const existing = await store.get((value as { id: string }).id);
        if (existing) continue;
        await store.save(value as ChatSession);
        imported += 1;
      }
      return c.json({ imported });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/v1/sessions/:id", async (c) => {
    const session = await store.get(c.req.param("id"));
    if (!session) return jsonError("会话不存在", 404);
    const draft = runs.draftMessage(session.id);
    if (!draft?.parts.length) return c.json(session);
    return c.json({
      ...session,
      messages: [...session.messages.filter((message) => message.id !== draft.id), draft],
    });
  });

  app.post("/v1/sessions/:id/title", async (c) => {
    try {
      const session = await store.get(c.req.param("id"));
      if (!session) return jsonError("会话不存在", 404);
      if (!hasUserMessageText(session.messages)) {
        return jsonError("对话还没有内容，无法生成标题");
      }
      const model = resolveSessionTitleModel(chatConfig.get(), session.modelId);
      if (!model) return jsonError("未配置可用模型，无法生成标题");
      const { generateText } = await import("ai");
      const result = await generateText({
        model: createConfiguredLanguageModel(model),
        system: SESSION_TITLE_SYSTEM,
        prompt: buildSessionTitlePrompt(session.messages),
        maxOutputTokens: sessionTitleMaxOutputTokens(model),
        maxRetries: 0,
      });
      const usage = normalizeAiUsage(result.usage);
      if (usage) {
        await aiUsageLogs.append({
          operation: "session-title",
          sessionId: session.id,
          modelId: model.id || model.name,
          provider: model.provider,
          model: model.name,
          usage,
        });
      }
      const title = normalizeGeneratedSessionTitle(result.text);
      if (!title) return jsonError("模型没有返回标题，请重试");
      await store.save({
        ...session,
        title,
      });
      return c.json({ title });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.put("/v1/sessions/:id/title", async (c) => {
    try {
      const session = await store.get(c.req.param("id"));
      if (!session) return jsonError("会话不存在", 404);
      const { title } = parseJson(
        await c.req.json().catch(() => ({})),
        z.object({ title: z.string().trim().min(1).max(120) }),
      );
      await store.save({ ...session, title });
      return c.json({ title });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 400);
    }
  });

  app.patch("/v1/sessions/:id", async (c) => {
    try {
      const current = await store.get(c.req.param("id"));
      if (!current) return jsonError("会话不存在", 404);
      if (current.source === "feishu") return jsonError("飞书会话为只读会话", 403);
      const body = await c.req.json();
      if (body && typeof body === "object" && "source" in body) {
        return jsonError("会话来源不可修改", 400);
      }
      const incomingMessages = Array.isArray(body.messages) ? body.messages : undefined;
      const messages = incomingMessages
        ? mergeSessionMessages(current.messages, incomingMessages)
        : undefined;
      const next = {
        ...current,
        ...body,
        ...(messages ? { messages } : {}),
        id: current.id,
        schemaVersion: 2 as const,
        updatedAt: new Date().toISOString(),
      };
      await store.save(next);
      return c.json(next);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.post("/v1/sessions/:id/plans", async (c) => {
    try {
      const session = await store.get(c.req.param("id"));
      if (!session) return jsonError("会话不存在", 404);
      const summary = await plans.create(session.id);
      const next = {
        ...session,
        planMode: "plan" as const,
        activePlanId: summary.id,
        plans: [summary, ...(session.plans ?? [])],
      };
      await store.save(next);
      return c.json({ ...summary, content: "" }, 201);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/v1/sessions/:id/plans", async (c) => {
    try {
      const session = await store.get(c.req.param("id"));
      if (!session) return jsonError("会话不存在", 404);
      return c.json(await plans.list(session.id));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });

  app.get("/v1/sessions/:id/plans/:planId", async (c) => {
    try {
      const session = await store.get(c.req.param("id"));
      if (!session) return jsonError("会话不存在", 404);
      return c.json(await plans.read(session.id, c.req.param("planId")));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error), 404);
    }
  });

  app.delete("/v1/sessions/:id", async (c) => {
    const id = c.req.param("id");
    await runs.stop(id);
    await store.delete(id);
    return c.body(null, 204);
  });

  app.post("/v1/sessions/:id/attachments", async (c) => {
    try {
      const session = await store.get(c.req.param("id"));
      if (!session) return jsonError("会话不存在", 404);
      const body = await c.req.json();
      const attachmentId = typeof body.id === "string" ? body.id : randomUUID();
      const fileName = typeof body.fileName === "string" ? body.fileName : "attachment";
      const base64 = typeof body.base64 === "string" ? body.base64 : "";
      const bytes = Buffer.from(
        base64.includes(",") ? (base64.split(",").pop() ?? "") : base64,
        "base64",
      );
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
        return jsonError("附件超过 20MB 上限", 400);
      }
      const compressed = await compressChatImage(bytes);
      const savedName =
        compressed.changed && compressed.mediaType
          ? replaceImageFileName(fileName, compressed.mediaType)
          : fileName;
      const savedPath = await store.saveAttachment(
        session.id,
        attachmentId,
        savedName,
        compressed.bytes,
      );
      return c.json(
        {
          id: attachmentId,
          fileName: savedName,
          path: savedPath,
          size: compressed.bytes.byteLength,
          ...(compressed.mediaType ? { mediaType: compressed.mediaType } : {}),
          ...(compressed.width ? { width: compressed.width } : {}),
          ...(compressed.height ? { height: compressed.height } : {}),
        },
        201,
      );
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.get("/v1/sessions/:id/attachments/:attachmentId", async (c) => {
    const value = await store.readAttachment(c.req.param("id"), c.req.param("attachmentId"));
    if (!value) return jsonError("附件不存在", 404);
    return new Response(value.bytes, { headers: { "Content-Type": "application/octet-stream" } });
  });
  app.delete("/v1/sessions/:id/attachments/:attachmentId", async (c) => {
    await store.deleteAttachment(c.req.param("id"), c.req.param("attachmentId"));
    return c.body(null, 204);
  });

  app.post("/v1/sessions/:id/runs", async (c) => {
    try {
      const session = await store.get(c.req.param("id"));
      if (session?.source === "feishu") return jsonError("飞书会话为只读会话", 403);
      if (session?.kind === "task") {
        return jsonError("任务会话不可交互", 400);
      }
      const body = parseJson(await c.req.json(), runInputSchema) as RunStartInput;
      if (body.mockLongResponse) {
        if (!session) return jsonError("会话不存在", 404);
        const messages = body.messages?.length
          ? body.messages
          : body.message
            ? [...session.messages, body.message]
            : session.messages;
        const runId = randomUUID();
        await activityLogs.append({
          level: "info",
          source: "开发测试",
          message: `开始长文本 Mock 回复 ${c.req.param("id")}`,
        });
        return withSseKeepAlive(
          createMockLongResponse({
            messages,
            messageId: runId,
            signal: c.req.raw.signal,
            onFinish: async (completedMessages) => {
              await store.save({
                ...session,
                title: body.title ?? session.title,
                updatedAt: new Date().toISOString(),
                messages: completedMessages,
              });
            },
          }),
        );
      }
      await activityLogs.append({
        level: "info",
        source: "模型调用",
        message: `开始运行会话 ${c.req.param("id")}`,
      });
      return withSseKeepAlive(await runs.start(c.req.param("id"), body));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(message, message.includes("已有正在运行") ? 409 : 400);
    }
  });

  app.post("/v1/sessions/:id/system-prompt/preview", async (c) => {
    try {
      const body = parseJson(await c.req.json(), runInputSchema) as RunStartInput;
      const session = await store.get(c.req.param("id"));
      if (session?.systemPrompt) return c.json(session.systemPrompt);
      if (session) {
        return c.json({
          text: "",
          sections: [],
          cwd: session.cwd,
        });
      }
      const current = session ?? ({ id: c.req.param("id"), cwd: undefined } as ChatSession);
      const cwd = resolveEffectiveWorkspace(current, body, (id) => workspaces.get(id)?.path);
      const workspaceToolInstructions = cwd
        ? workspaceSearchInstructions(body.toolNames ?? [])
        : "";
      return c.json(
        await buildSystemPrompt({
          cwd,
          system: body.system,
          memory: body.memory,
          workspaceToolInstructions,
          todoToolInstructions: TODO_TOOL_INSTRUCTIONS,
          taskToolInstructions: CREATE_TASK_TOOL_INSTRUCTIONS,
          skillToolInstructions: await loadBuiltinSkillsCatalog(),
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(message, message === "会话不存在" ? 404 : 400);
    }
  });

  app.post("/v1/sessions/:id/runs/stop", async (c) =>
    c.json({ stopped: await runs.stop(c.req.param("id")) }),
  );

  app.get("/v1/events", async (c) => {
    const sessionId = c.req.query("sessionId");
    return streamSSE(c, async (stream) => {
      const subscription = events.subscribe(sessionId);
      try {
        const snapshot = await store.list(runs.statusMap(), runs.runStartedAtMap());
        await stream.writeSSE({ event: "snapshot", data: JSON.stringify(snapshot) });
        while (!stream.aborted) {
          const event = await subscription.next(15_000);
          if (event) {
            await stream.writeSSE({ event: event.type, id: event.id, data: JSON.stringify(event) });
          } else if (!stream.aborted) {
            await stream.writeSSE({ event: "ping", data: "{}" });
          }
        }
      } finally {
        subscription.close();
      }
    });
  });

  app.onError((error) => jsonError(error.message || "服务器错误", 500));
  return {
    app,
    store,
    events,
    runs,
    plans,
    config,
    shutdown: async () => {
      automationScheduler.stop();
      await feishu.stop();
      await core.shutdown();
    },
  };
}
