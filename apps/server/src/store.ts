import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatSession, SessionIndexItem, SessionStatus } from "./protocol.ts";

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

async function atomicWrite(file: string, contents: string) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, contents, "utf8");
  await rename(temporary, file);
}

export class SessionStore {
  readonly root: string;
  private readonly sessionsRoot: string;

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
  ) {
    const entries = await readdir(this.sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions: SessionIndexItem[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      const session = await this.get(entry.name);
      if (!session) continue;
      const runStartedAt = runStartedAts.get(session.id);
      sessions.push({
        id: session.id,
        title: session.title,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        messageCount: session.messages.length,
        attachmentCount: session.attachments.length,
        workspaceId: session.workspaceId,
        cwd: session.cwd,
        status: statuses.get(session.id) ?? "idle",
        lastRunSummary: latestRunSummary(session),
        ...(runStartedAt ? { runStartedAt } : {}),
      });
    }
    return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async get(id: string): Promise<ChatSession | null> {
    if (!validId(id)) return null;
    const value = await readJson<unknown>(path.join(this.sessionsRoot, id, "session.json"), null);
    if (!isSession(value)) return null;
    return {
      ...value,
      schemaVersion: 2,
      attachments: value.attachments ?? [],
      messages: value.messages ?? [],
    };
  }

  async save(session: ChatSession) {
    if (!validId(session.id)) throw new Error("invalid chat session id");
    const directory = path.join(this.sessionsRoot, session.id);
    await mkdir(directory, { recursive: true });
    await atomicWrite(path.join(directory, "session.json"), JSON.stringify(session, null, 2));
  }

  async delete(id: string) {
    if (!validId(id)) throw new Error("invalid chat session id");
    await rm(path.join(this.sessionsRoot, id), { recursive: true, force: true });
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
      let session: unknown = null;
      for (const sessionPath of [
        path.join(legacyRoot, id, "session.json"),
        path.join(legacyRoot, "sessions", id, "session.json"),
      ]) {
        session = await readJson<unknown>(sessionPath, null);
        if (isSession(session)) break;
      }
      if (!isSession(session)) continue;
      await this.save({ ...session, schemaVersion: 2 });
      imported += 1;
    }
    return imported;
  }
}
