import { randomUUID } from "node:crypto";
import path from "node:path";
import { cors } from "hono/cors";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { ServerConfig } from "./config.ts";
import { EventHub } from "./events.ts";
import { RunRegistry } from "./run-registry.ts";
import type { ChatSession, RunStartInput } from "./protocol.ts";
import { SessionStore } from "./store.ts";
import { ArchiveStore } from "./archive-store.ts";
import { ChatConfigStore } from "./chat-config.ts";
import { MemoryStore } from "./memory-store.ts";
import { scanSkills } from "./skills-store.ts";
import { McpRuntime } from "./mcp-runtime.ts";
import { closeClientTools } from "./client-tools.ts";

const runInputSchema = z.object({
  messages: z.array(z.unknown()).optional(),
  message: z.unknown().optional(),
  model: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    provider: z.string().optional(),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1).optional(),
    responsive: z.boolean().optional(),
    supportsTools: z.boolean().optional(),
  }).optional(),
  modelId: z.string().optional(),
  system: z.string().optional(),
  memory: z.string().optional(),
  cwd: z.string().optional(),
  workspaceId: z.string().optional(),
  sandboxMode: z.enum(["ask", "auto", "full"]).optional(),
  title: z.string().optional(),
  toolNames: z.array(z.string()).max(100).optional(),
});

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
  const legacyDirs = [
    process.env.CHAT_SERVER_LEGACY_DIR,
    ...(process.env.CHAT_SERVER_LEGACY_DIRS?.split(path.delimiter) ?? []),
  ].filter((directory): directory is string => Boolean(directory?.trim()));
  for (const legacyDir of [...new Set(legacyDirs)]) {
    await store.importDirectory(legacyDir);
  }
  const events = new EventHub();
  const chatConfig = new ChatConfigStore(config.dataDir);
  await chatConfig.init(process.env.CHAT_SERVER_LEGACY_SETTINGS_FILE);
  const runs = new RunRegistry(store, events, chatConfig);
  const memory = new MemoryStore(config.dataDir);
  await memory.init(process.env.CHAT_SERVER_LEGACY_MEMORY_FILE);
  const archive = new ArchiveStore(config.dataDir);
  await archive.init(process.env.CHAT_SERVER_LEGACY_ARCHIVE_DIR);
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

  app.get("/v1/config", (c) => c.json({ host: config.host, port: config.port, restartRequired: false }));
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
  app.patch("/v1/chat-config", async (c) => {
    try {
      return c.json(await chatConfig.update(await c.req.json()));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
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
      await mcp.start(await c.req.json());
      return c.body(null, 204);
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/mcp/test", async (c) => {
    try {
      return c.json(await mcp.test(await c.req.json()));
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
      return c.json(await mcp.callTool(c.req.param("id"), body.toolName, body.arguments));
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.post("/v1/mcp/:id/stop", async (c) => {
    await mcp.stop(c.req.param("id"));
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
      await archive.save({ ...body, id: c.req.param("id") });
      return c.json({ id: c.req.param("id"), overwritten: Boolean(await archive.get(c.req.param("id"))) });
    } catch (error) {
      return jsonError(error instanceof Error ? error.message : String(error));
    }
  });
  app.delete("/v1/archive/:id", async (c) => {
    await archive.delete(c.req.param("id"));
    return c.body(null, 204);
  });
  app.post("/v1/archive/scan/:source", async (c) => {
    const source = c.req.param("source");
    const root = source === "codex" ? path.join(process.env.HOME || "", ".codex") : path.join(process.env.HOME || "", ".claude");
    const results: Array<Record<string, unknown>> = [];
    const walk = async (directory: string): Promise<void> => {
      const entries = await (await import("node:fs/promises")).readdir(directory, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await walk(target);
        } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
          const metadata = await (await import("node:fs/promises")).stat(target).catch(() => null);
          results.push({ source, externalId: entry.name.replace(/\.jsonl$/i, ""), sourcePath: target, updatedAt: metadata?.mtime.toISOString(), size: metadata?.size ?? 0 });
        }
      }
    };
    await walk(root);
    return c.json(results);
  });
  app.post("/v1/archive/read-file", async (c) => {
    try {
      const body = await c.req.json();
      const requested = typeof body.path === "string" ? body.path : "";
      const roots = [path.join(process.env.HOME || "", ".codex"), path.join(process.env.HOME || "", ".claude")];
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
  app.post("/v1/archive/path-exists", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const requested = typeof body.path === "string" ? body.path : "";
    const roots = [path.join(process.env.HOME || "", ".codex"), path.join(process.env.HOME || "", ".claude")];
    const resolved = path.resolve(requested);
    const allowed = roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`));
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
      const session = emptySession(typeof body.id === "string" ? body.id : undefined);
      const next: ChatSession = {
        ...session,
        title: typeof body.title === "string" && body.title.trim() ? body.title.trim() : session.title,
        workspaceId: typeof body.workspaceId === "string" ? body.workspaceId : undefined,
        cwd: typeof body.cwd === "string" ? body.cwd : undefined,
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
      const sessions = parseJson(payload, z.object({ sessions: z.array(z.unknown()).max(1000) })).sessions;
      let imported = 0;
      for (const value of sessions) {
        if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") continue;
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

  app.patch("/v1/sessions/:id", async (c) => {
    try {
      const current = await store.get(c.req.param("id"));
      if (!current) return jsonError("会话不存在", 404);
      const body = await c.req.json();
      const next = {
        ...current,
        ...body,
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
      const bytes = Buffer.from(base64.includes(",") ? base64.split(",").pop() ?? "" : base64, "base64");
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
      return await runs.start(c.req.param("id"), body);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return jsonError(message, message.includes("已有正在运行") ? 409 : 400);
    }
  });

  app.post("/v1/sessions/:id/runs/stop", (c) =>
    c.json({ stopped: runs.stop(c.req.param("id")) }),
  );

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
      await runs.shutdown();
      await mcp.close();
      closeClientTools();
    },
  };
}
