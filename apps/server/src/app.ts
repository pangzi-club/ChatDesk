import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { ActivityLogStore } from "./activity-log-store.ts";
import { ArchiveStore } from "./archive-store.ts";
import { AutomationScheduler, AutomationStore } from "./automation-store.ts";
import { ChatConfigStore } from "./chat-config.ts";
import { closeClientTools } from "./client-tools.ts";
import type { ServerConfig } from "./config.ts";
import { EventHub } from "./events.ts";
import { ImageGenerationStore } from "./image-generation-store.ts";
import { McpRuntime } from "./mcp-runtime.ts";
import { MemoryStore } from "./memory-store.ts";
import { listProviderModels, testModelConnection } from "./model-test.ts";
import { nodePlatform } from "./platform/index.ts";
import type { ChatSession, RunStartInput } from "./protocol.ts";
import { RunRegistry, resolveEffectiveWorkspace } from "./run-registry.ts";
import { scanSkills } from "./skills-store.ts";
import { SessionStore } from "./store.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { WorkspaceStore } from "./workspace-store.ts";

const runInputSchema = z.object({
  messages: z.array(z.unknown()).optional(),
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

export type ChatServer = {
  app: Hono;
  store: SessionStore;
  events: EventHub;
  runs: RunRegistry;
  config: ServerConfig;
  shutdown: () => Promise<void>;
};

export async function createChatServer(config: ServerConfig): Promise<ChatServer> {
  const store = new SessionStore(config.dataDir);
  await store.init();
  const events = new EventHub();
  const chatConfig = new ChatConfigStore(config.dataDir);
  await chatConfig.init();
  const memory = new MemoryStore(config.dataDir);
  await memory.init();
  const archive = new ArchiveStore(config.dataDir);
  await archive.init();
  const activityLogs = new ActivityLogStore(config.dataDir);
  await activityLogs.init();
  await activityLogs.append({
    level: "info",
    source: "Chat Server",
    message: "Chat Server 已启动",
  });
  const imageGeneration = new ImageGenerationStore(config.dataDir);
  await imageGeneration.init();
  const workspaces = new WorkspaceStore(config.dataDir);
  await workspaces.init();
  const runs = new RunRegistry(store, events, chatConfig, (id) => workspaces.get(id)?.path);
  const automations = new AutomationStore(config.dataDir);
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
  const mcp = new McpRuntime();
  await runs.initialize();
  const app = new Hono();

  app.use(
    "*",
    cors({
      origin: [
        "http://localhost:1420",
        "http://127.0.0.1:1420",
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
      ],
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
    await workspaces.remove(workspace.id);
    await activityLogs.append({
      level: "info",
      source: "Workspace",
      message: `已移除 ${workspace.name}`,
    });
    return c.body(null, 204);
  });
  app.get("/v1/workspaces/:id/git", async (c) => {
    const workspace = workspaces.get(c.req.param("id"));
    if (!workspace) return jsonError("workspace 不存在", 404);
    try {
      return c.json(await nodePlatform.inspectGit(workspace.path));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.get("/v1/workspaces/:id/git/diff", async (c) => {
    const workspace = workspaces.get(c.req.param("id"));
    if (!workspace) return jsonError("workspace 不存在", 404);
    try {
      const filePath = c.req.query("path") || "";
      return c.json(await nodePlatform.readGitDiff(workspace.path, filePath));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.get("/v1/workspaces/:id/files", async (c) => {
    const workspace = workspaces.get(c.req.param("id"));
    if (!workspace) return jsonError("workspace 不存在", 404);
    try {
      return c.json(await nodePlatform.listDir(workspace.path, c.req.query("path") || "."));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/workspaces/:id/file", async (c) => {
    const workspace = workspaces.get(c.req.param("id"));
    if (!workspace) return jsonError("workspace 不存在", 404);
    try {
      const body = await c.req.json();
      const action = typeof body.action === "string" ? body.action : "read";
      const filePath = typeof body.path === "string" ? body.path : "";
      if (action === "read") return c.json(await nodePlatform.readFile(workspace.path, filePath));
      if (action === "write") {
        const result = await nodePlatform.writeFile(
          workspace.path,
          filePath,
          String(body.content ?? ""),
        );
        return c.json(result);
      }
      if (action === "edit") {
        return c.json(
          await nodePlatform.editFile(
            workspace.path,
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
    const workspace = workspaces.get(c.req.param("id"));
    if (!workspace) return jsonError("workspace 不存在", 404);
    try {
      const body = await c.req.json().catch(() => ({}));
      return c.json(await nodePlatform.searchFiles(workspace.path, body));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/workspaces/:id/shell", async (c) => {
    const workspace = workspaces.get(c.req.param("id"));
    if (!workspace) return jsonError("workspace 不存在", 404);
    try {
      const body = await c.req.json();
      const mode = body.mode === "full" || body.mode === "auto" ? body.mode : "ask";
      return c.json(
        await nodePlatform.runShell(
          workspace.path,
          String(body.command ?? ""),
          mode,
          typeof body.cwd === "string" ? body.cwd : undefined,
          body.allowOutside === true,
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
  app.get("/v1/sandbox-reviews", (c) => c.json(runs.reviewLogs(c.req.query("sessionId"))));
  app.patch("/v1/chat-config", async (c) => {
    try {
      return c.json(await chatConfig.update(await c.req.json()));
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

  app.get("/v1/sessions", async (c) => c.json(await store.list(runs.statusMap())));

  app.post("/v1/sessions", async (c) => {
    try {
      const body = await c.req.json().catch(() => ({}));
      const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : undefined;
      if (workspaceId && !workspaces.get(workspaceId)) return jsonError("workspace 不存在", 400);
      const session = emptySession(typeof body.id === "string" ? body.id : undefined);
      const next: ChatSession = {
        ...session,
        title:
          typeof body.title === "string" && body.title.trim() ? body.title.trim() : session.title,
        workspaceId,
        cwd: workspaceId ? workspaces.get(workspaceId)?.path : undefined,
      };
      await store.save(next);
      events.publish({ type: "session.status", sessionId: next.id, status: "idle" });
      return c.json(next, 201);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
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
    const persisted = session.messages.find((message) => message.id === draft.id);
    const draftWithMetadata = persisted
      ? {
          ...persisted,
          parts: [
            ...persisted.parts.filter((part) => part.type !== "text"),
            ...draft.parts.filter((part) => part.type === "text"),
          ],
        }
      : draft;
    return c.json({
      ...session,
      messages: [
        ...session.messages.filter((message) => message.id !== draft.id),
        draftWithMetadata,
      ],
    });
  });

  app.patch("/v1/sessions/:id", async (c) => {
    try {
      const current = await store.get(c.req.param("id"));
      if (!current) return jsonError("会话不存在", 404);
      const body = await c.req.json();
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

  app.delete("/v1/sessions/:id", async (c) => {
    const id = c.req.param("id");
    runs.stop(id);
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
      const savedPath = await store.saveAttachment(session.id, attachmentId, fileName, bytes);
      return c.json({ id: attachmentId, fileName, path: savedPath, size: bytes.byteLength }, 201);
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
      const body = parseJson(await c.req.json(), runInputSchema) as RunStartInput;
      await activityLogs.append({
        level: "info",
        source: "模型调用",
        message: `开始运行会话 ${c.req.param("id")}`,
      });
      return await runs.start(c.req.param("id"), body);
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
      const current = session ?? ({ cwd: undefined } as ChatSession);
      const cwd = resolveEffectiveWorkspace(current, body, (id) => workspaces.get(id)?.path);
      const workspaceToolInstructions = cwd
        ? "本地源码检索规则：按文件名或关键词查找时必须使用 search_files，它支持 query 关键词并遵循 workspace 的 Git 排除规则；不要通过 bash 执行递归 grep、find 或 rg，尤其不要扫描 node_modules、.git、dist、target。"
        : "";
      return c.json(
        await buildSystemPrompt({
          cwd,
          system: body.system,
          memory: body.memory,
          workspaceToolInstructions,
        }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(message, message === "会话不存在" ? 404 : 400);
    }
  });

  app.post("/v1/sessions/:id/runs/stop", (c) => c.json({ stopped: runs.stop(c.req.param("id")) }));

  app.get("/v1/events", async (c) => {
    const sessionId = c.req.query("sessionId");
    return streamSSE(c, async (stream) => {
      const subscription = events.subscribe(sessionId);
      try {
        const snapshot = await store.list(runs.statusMap());
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
    config,
    shutdown: async () => {
      automationScheduler.stop();
      await runs.shutdown();
      await mcp.close();
      closeClientTools();
    },
  };
}
