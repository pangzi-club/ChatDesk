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

const runInputSchema = z.object({
  messages: z.array(z.unknown()).optional(),
  message: z.unknown().optional(),
  model: z.object({
    id: z.string().optional(),
    name: z.string().min(1),
    provider: z.string().optional(),
    baseUrl: z.string().url(),
    apiKey: z.string().min(1),
    responsive: z.boolean().optional(),
    supportsTools: z.boolean().optional(),
  }),
  system: z.string().optional(),
  memory: z.string().optional(),
  cwd: z.string().optional(),
  workspaceId: z.string().optional(),
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
  const runs = new RunRegistry(store, events);
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
  // Authentication is intentionally disabled for the local desktop server for now.
  // Keep the runtime token plumbing in place so this boundary can be restored later.

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
  return { app, store, events, runs, config };
}
