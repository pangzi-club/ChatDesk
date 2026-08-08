import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function atomicWrite(file: string, contents: string) {
  const temporary = `${file}.${process.pid}.tmp`;
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

  async list(statuses: ReadonlyMap<string, SessionStatus> = new Map()) {
    const entries = await readdir(this.sessionsRoot, { withFileTypes: true }).catch(() => []);
    const sessions: SessionIndexItem[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      const session = await this.get(entry.name);
      if (!session) continue;
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

  async importDirectory(legacyRoot: string) {
    const legacyIndex = await readJson<unknown>(path.join(legacyRoot, INDEX_FILE), []);
    const ids = Array.isArray(legacyIndex)
      ? legacyIndex.flatMap((item) =>
          item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string"
            ? [(item as { id: string }).id]
            : [],
        )
      : [];
    let imported = 0;
    for (const id of ids) {
      if (!validId(id) || (await this.get(id))) continue;
      const session = await readJson<unknown>(
        path.join(legacyRoot, id, "session.json"),
        null,
      );
      if (!isSession(session)) continue;
      await this.save({ ...session, schemaVersion: 2 });
      imported += 1;
    }
    return imported;
  }
}
