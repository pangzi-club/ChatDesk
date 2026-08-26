import { randomUUID } from "node:crypto";
import {
  appendFile,
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  type ChatSession,
  type SessionIndexItem,
  type SessionStatus,
  sessionSearchRelevance,
} from "./protocol.ts";
import {
  cacheFromRawLines,
  cacheFromSerializedLines,
  jsonlByteSize,
  parseMessagesJsonl,
  prefixUnchanged,
  SESSION_MESSAGES_FILE,
  SESSION_META_FILE,
  type SessionWriteCache,
  serializeMessageLine,
  serializeMessagesJsonl,
  serializeSessionMeta,
  splitJsonlLines,
} from "./session-jsonl.ts";

const INDEX_FILE = "index.json";

function validId(id: string) {
  return /^[a-zA-Z0-9-]{1,128}$/.test(id);
}

function isSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<ChatSession>;
  return (
    ((record as { schemaVersion?: unknown }).schemaVersion === 1 ||
      (record as { schemaVersion?: unknown }).schemaVersion === 2) &&
    typeof record.id === "string" &&
    validId(record.id) &&
    typeof record.title === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    Array.isArray(record.messages) &&
    Array.isArray(record.attachments)
  );
}

function latestRunSummary(session: ChatSession) {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const metadata = session.messages[index]?.metadata;
    if (!metadata || typeof metadata !== "object") continue;
    const runSummary = (metadata as { runSummary?: SessionIndexItem["lastRunSummary"] }).runSummary;
    if (runSummary) return runSummary;
  }
  return undefined;
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}

async function atomicWrite(file: string, contents: string) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, file);
}

async function replaceLastJsonlLine(file: string, start: number, line: string) {
  const payload = Buffer.from(`${line}\n`, "utf8");
  const handle = await open(file, "r+");
  try {
    await handle.write(payload, 0, payload.length, start);
    await handle.truncate(start + payload.length);
  } finally {
    await handle.close();
  }
}

export class SessionStore {
  readonly root: string;
  private readonly sessionsRoot: string;
  private readonly writeCaches = new Map<string, SessionWriteCache>();
  private readonly tails = new Map<string, Promise<void>>();

  constructor(root: string) {
    this.root = root;
    this.sessionsRoot = path.join(root, "sessions");
  }

  async init() {
    await mkdir(this.sessionsRoot, { recursive: true });
  }

  async list(
    statuses: ReadonlyMap<string, SessionStatus> = new Map(),
    runStartedAts: ReadonlyMap<string, string> = new Map(),
    options: { query?: string; limit?: number } = {},
  ) {
    const query = options.query?.trim() ?? "";
    const limit = Number.isFinite(options.limit)
      ? Math.max(1, Math.min(100, options.limit ?? 100))
      : 100;
    const entries = await readdir(this.sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions: Array<{ item: SessionIndexItem; relevance: number }> = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      const session = await this.get(entry.name);
      if (!session) continue;
      const relevance = sessionSearchRelevance(session, query);
      if (relevance < 0) continue;
      const runStartedAt = runStartedAts.get(session.id);
      sessions.push({
        relevance,
        item: {
          id: session.id,
          title: session.title,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length,
          attachmentCount: session.attachments.length,
          workspaceId: session.workspaceId,
          cwd: session.cwd,
          ...(session.kind ? { kind: session.kind } : {}),
          ...(session.parentSessionId ? { parentSessionId: session.parentSessionId } : {}),
          status: statuses.get(session.id) ?? "idle",
          lastRunSummary: latestRunSummary(session),
          ...(runStartedAt ? { runStartedAt } : {}),
          ...(query ? { searchRelevance: relevance } : {}),
        },
      });
    }
    return sessions
      .sort(
        (a, b) =>
          (query ? b.relevance - a.relevance : 0) ||
          b.item.updatedAt.localeCompare(a.item.updatedAt),
      )
      .filter(({ item }) => item.kind !== "ephemeral")
      .slice(0, limit)
      .map(({ item }) => item);
  }

  async all(): Promise<ChatSession[]> {
    const entries = await readdir(this.sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions: ChatSession[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      const session = await this.get(entry.name);
      if (session) sessions.push(session);
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<ChatSession | null> {
    if (!validId(id)) return null;
    return this.enqueue(id, () => this.getUnlocked(id));
  }

  async save(session: ChatSession) {
    if (!validId(session.id)) throw new Error("invalid chat session id");
    await this.enqueue(session.id, () => this.saveUnlocked(session));
  }

  async delete(id: string) {
    if (!validId(id)) throw new Error("invalid chat session id");
    await this.enqueue(id, async () => {
      this.writeCaches.delete(id);
      await rm(path.join(this.sessionsRoot, id), { recursive: true, force: true });
    });
  }

  attachmentPath(sessionId: string, attachmentId: string, fileName: string) {
    if (!validId(sessionId) || !validId(attachmentId))
      throw new Error("invalid chat attachment id");
    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 180) || "attachment";
    return path.join(this.sessionsRoot, sessionId, "attachments", `${attachmentId}-${safeName}`);
  }

  async saveAttachment(
    sessionId: string,
    attachmentId: string,
    fileName: string,
    bytes: Uint8Array,
  ) {
    const target = this.attachmentPath(sessionId, attachmentId, fileName);
    await mkdir(path.dirname(target), { recursive: true });
    const temporary = `${target}.tmp`;
    await writeFile(temporary, bytes);
    await rename(temporary, target);
    return target;
  }

  async readAttachment(sessionId: string, attachmentId: string) {
    if (!validId(sessionId) || !validId(attachmentId)) return null;
    const directory = path.join(this.sessionsRoot, sessionId, "attachments");
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const entry = entries.find((item) => item.isFile() && item.name.startsWith(`${attachmentId}-`));
    if (!entry) return null;
    return {
      name: entry.name.slice(attachmentId.length + 1),
      bytes: await readFile(path.join(directory, entry.name)),
    };
  }

  async deleteAttachment(sessionId: string, attachmentId: string) {
    const value = await this.readAttachment(sessionId, attachmentId);
    if (!value) return false;
    await rm(
      path.join(this.sessionsRoot, sessionId, "attachments", `${attachmentId}-${value.name}`),
      { force: true },
    );
    return true;
  }

  async importDirectory(legacyRoot: string) {
    const legacyIndex = await readJson<unknown>(path.join(legacyRoot, INDEX_FILE), []);
    const ids = new Set<string>();
    if (Array.isArray(legacyIndex)) {
      for (const item of legacyIndex) {
        if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
          ids.add((item as { id: string }).id);
        }
      }
    }
    for (const sessionsRoot of [legacyRoot, path.join(legacyRoot, "sessions")]) {
      const entries = await readdir(sessionsRoot, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (entry.isDirectory() && validId(entry.name)) ids.add(entry.name);
      }
    }
    let imported = 0;
    for (const id of ids) {
      if (!validId(id) || (await this.get(id))) continue;
      let session: ChatSession | null = null;
      for (const directory of [path.join(legacyRoot, id), path.join(legacyRoot, "sessions", id)]) {
        session = await this.readSessionDirectory(directory);
        if (session) break;
      }
      if (!session) continue;
      await this.save({ ...session, schemaVersion: 2 });
      imported += 1;
    }
    return imported;
  }

  private enqueue<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve();
    const current = previous.then(task, task);
    this.tails.set(
      id,
      current.then(
        () => undefined,
        () => undefined,
      ),
    );
    return current;
  }

  private sessionDirectory(id: string) {
    return path.join(this.sessionsRoot, id);
  }

  private async getUnlocked(id: string): Promise<ChatSession | null> {
    const session = await this.readSessionDirectory(this.sessionDirectory(id));
    if (!session) {
      this.writeCaches.delete(id);
      return null;
    }
    return session;
  }

  private async readSessionDirectory(directory: string): Promise<ChatSession | null> {
    const metaValue = await readJson<unknown>(path.join(directory, SESSION_META_FILE), null);
    if (!metaValue || typeof metaValue !== "object") return null;
    const { messages: _ignored, ...meta } = metaValue as Record<string, unknown>;
    const messagesFile = path.join(directory, SESSION_MESSAGES_FILE);
    const messagesText = (await readText(messagesFile)) ?? "";
    const parsed = parseMessagesJsonl(messagesText);
    if (!parsed.ok) return null;
    const session = {
      ...meta,
      schemaVersion: 2,
      attachments: Array.isArray(meta.attachments) ? meta.attachments : [],
      messages: parsed.messages,
    };
    if (!isSession(session)) return null;
    const id = session.id;
    const rawLines = splitJsonlLines(messagesText);
    const keptRawLines = rawLines.slice(0, parsed.messages.length);
    if (keptRawLines.length < rawLines.length) {
      const handle = await open(messagesFile, "r+");
      try {
        await handle.truncate(jsonlByteSize(keptRawLines));
      } finally {
        await handle.close();
      }
    }
    if (directory === this.sessionDirectory(id)) {
      this.writeCaches.set(id, cacheFromRawLines(keptRawLines, session.messages));
    }
    return session;
  }

  private async saveUnlocked(session: ChatSession) {
    const directory = this.sessionDirectory(session.id);
    await mkdir(directory, { recursive: true });
    await atomicWrite(path.join(directory, SESSION_META_FILE), serializeSessionMeta(session));
    const messagesFile = path.join(directory, SESSION_MESSAGES_FILE);
    const nextLines = session.messages.map((message) => serializeMessageLine(message));
    const cache = this.writeCaches.get(session.id);

    if (!cache) {
      await atomicWrite(messagesFile, serializeMessagesJsonl(session.messages));
      this.writeCaches.set(session.id, cacheFromSerializedLines(nextLines));
      return;
    }

    if (
      nextLines.length === cache.lines.length + 1 &&
      prefixUnchanged(cache.lines, nextLines, cache.lines.length)
    ) {
      const line = nextLines[nextLines.length - 1] ?? "";
      await appendFile(messagesFile, `${line}\n`, "utf8");
      this.writeCaches.set(session.id, {
        lines: nextLines,
        lastLineStart: cache.fileSize,
        fileSize: cache.fileSize + Buffer.byteLength(`${line}\n`, "utf8"),
      });
      return;
    }

    if (
      nextLines.length === cache.lines.length &&
      nextLines.length > 0 &&
      prefixUnchanged(cache.lines, nextLines, nextLines.length - 1)
    ) {
      const line = nextLines[nextLines.length - 1] ?? "";
      if (line === cache.lines[cache.lines.length - 1]) return;
      await replaceLastJsonlLine(messagesFile, cache.lastLineStart, line);
      this.writeCaches.set(session.id, {
        lines: nextLines,
        lastLineStart: cache.lastLineStart,
        fileSize: cache.lastLineStart + Buffer.byteLength(`${line}\n`, "utf8"),
      });
      return;
    }

    if (nextLines.length === 0 && cache.lines.length === 0) return;

    await atomicWrite(messagesFile, serializeMessagesJsonl(session.messages));
    this.writeCaches.set(session.id, cacheFromSerializedLines(nextLines));
  }
}
