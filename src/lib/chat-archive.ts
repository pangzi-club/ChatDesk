import { invoke } from "@tauri-apps/api/core";

export const ARCHIVE_SCHEMA_VERSION = 1;

export type ArchiveSource = "codex" | "claude-code" | "native";
export type ImportedArchiveSource = Exclude<ArchiveSource, "native">;

export type ArchiveAsset = {
  id: string;
  kind: "image" | "file";
  fileName?: string;
  mediaType?: string;
  path?: string;
  url?: string;
};

export type ArchiveTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningOutputTokens?: number;
};

export type ArchiveToolCall = {
  id: string;
  toolName: string;
  state: string;
  input?: unknown;
  output?: unknown;
  errorText?: string;
};

export type ArchiveMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
  assets?: ArchiveAsset[];
  usage?: ArchiveTokenUsage;
  toolCalls?: ArchiveToolCall[];
};

export type ArchiveSession = {
  schemaVersion: typeof ARCHIVE_SCHEMA_VERSION;
  id: string;
  source: ImportedArchiveSource;
  externalId: string;
  title: string;
  cwd?: string;
  model?: string;
  sourcePath: string;
  createdAt: string;
  updatedAt: string;
  importedAt: string;
  messages: ArchiveMessage[];
  assetCount: number;
  usageTotal?: ArchiveTokenUsage;
};

export type ArchiveIndexItem = Pick<
  ArchiveSession,
  | "id"
  | "source"
  | "externalId"
  | "title"
  | "cwd"
  | "sourcePath"
  | "createdAt"
  | "updatedAt"
  | "importedAt"
  | "assetCount"
  | "usageTotal"
> & {
  messageCount: number;
};

export type SaveArchiveResult = {
  overwritten: boolean;
  id: string;
};

export type ScannedSession = {
  source: ImportedArchiveSource;
  externalId: string;
  title?: string | null;
  cwd?: string | null;
  sourcePath: string;
  updatedAt?: string | null;
  size: number;
};

export type HistoryListItem = {
  id: string;
  source: ArchiveSource;
  title: string;
  updatedAt: string;
  createdAt: string;
  messageCount: number;
  assetCount: number;
  cwd?: string;
  externalId?: string;
};

const INDEX_KEY = "m-dashboard-chat-archive-index-v1";
const SESSION_KEY_PREFIX = "m-dashboard-chat-archive-session-";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function sortByUpdatedAt<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isImportedSource(value: unknown): value is ImportedArchiveSource {
  return value === "codex" || value === "claude-code";
}

function isArchiveAsset(value: unknown): value is ArchiveAsset {
  if (!value || typeof value !== "object") return false;
  const asset = value as Partial<ArchiveAsset>;
  return (
    typeof asset.id === "string" &&
    (asset.kind === "image" || asset.kind === "file") &&
    (asset.path === undefined || typeof asset.path === "string") &&
    (asset.url === undefined || typeof asset.url === "string")
  );
}

function isArchiveTokenUsage(value: unknown): value is ArchiveTokenUsage {
  if (!value || typeof value !== "object") return false;
  const usage = value as Record<string, unknown>;
  const keys = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningOutputTokens",
  ] as const;
  return keys.every((key) => usage[key] === undefined || typeof usage[key] === "number");
}

function isArchiveToolCall(value: unknown): value is ArchiveToolCall {
  if (!value || typeof value !== "object") return false;
  const call = value as Partial<ArchiveToolCall>;
  return (
    typeof call.id === "string" &&
    typeof call.toolName === "string" &&
    typeof call.state === "string" &&
    (call.errorText === undefined || typeof call.errorText === "string")
  );
}

function isArchiveMessage(value: unknown): value is ArchiveMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<ArchiveMessage>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.text === "string" &&
    (message.assets === undefined ||
      (Array.isArray(message.assets) && message.assets.every(isArchiveAsset))) &&
    (message.usage === undefined || isArchiveTokenUsage(message.usage)) &&
    (message.toolCalls === undefined ||
      (Array.isArray(message.toolCalls) && message.toolCalls.every(isArchiveToolCall)))
  );
}

function isArchiveIndexItem(value: unknown): value is ArchiveIndexItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ArchiveIndexItem>;
  return (
    typeof item.id === "string" &&
    isImportedSource(item.source) &&
    typeof item.externalId === "string" &&
    typeof item.title === "string" &&
    typeof item.sourcePath === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    typeof item.importedAt === "string" &&
    typeof item.messageCount === "number" &&
    typeof item.assetCount === "number"
  );
}

function isArchiveSession(value: unknown): value is ArchiveSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<ArchiveSession>;
  return (
    session.schemaVersion === ARCHIVE_SCHEMA_VERSION &&
    typeof session.id === "string" &&
    isImportedSource(session.source) &&
    typeof session.externalId === "string" &&
    typeof session.title === "string" &&
    typeof session.sourcePath === "string" &&
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string" &&
    typeof session.importedAt === "string" &&
    typeof session.assetCount === "number" &&
    Array.isArray(session.messages) &&
    session.messages.every(isArchiveMessage) &&
    (session.usageTotal === undefined || isArchiveTokenUsage(session.usageTotal))
  );
}

function isScannedSession(value: unknown): value is ScannedSession {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ScannedSession>;
  return (
    isImportedSource(item.source) &&
    typeof item.externalId === "string" &&
    typeof item.sourcePath === "string" &&
    typeof item.size === "number"
  );
}

export function archiveKey(source: ImportedArchiveSource, externalId: string) {
  return `${source}:${externalId}`;
}

export function createArchiveSessionId() {
  return crypto.randomUUID() as string;
}

export function truncateTitle(text: string, max = 40) {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "未命名对话";
  return Array.from(compact).slice(0, max).join("") + (Array.from(compact).length > max ? "…" : "");
}

export async function loadArchiveIndex(): Promise<ArchiveIndexItem[]> {
  try {
    const contents = isTauri() ? await invoke<string>("read_chat_archive_index") : null;
    const parsed = parseJson<unknown>(contents ?? window.localStorage.getItem(INDEX_KEY), []);
    return sortByUpdatedAt(Array.isArray(parsed) ? parsed.filter(isArchiveIndexItem) : []);
  } catch (error) {
    console.error("Failed to load chat archive index", error);
    const fallback = parseJson<unknown>(window.localStorage.getItem(INDEX_KEY), []);
    return sortByUpdatedAt(Array.isArray(fallback) ? fallback.filter(isArchiveIndexItem) : []);
  }
}

export async function loadArchiveSession(id: string): Promise<ArchiveSession | null> {
  try {
    const contents = isTauri()
      ? await invoke<string | null>("read_chat_archive_session", { sessionId: id })
      : window.localStorage.getItem(`${SESSION_KEY_PREFIX}${id}`);
    const parsed = parseJson<unknown>(contents, null);
    return isArchiveSession(parsed) ? parsed : null;
  } catch (error) {
    console.error("Failed to load chat archive session", error);
    return null;
  }
}

async function removeArchiveSessionFile(id: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_chat_archive_session", { sessionId: id });
  } else {
    window.localStorage.removeItem(`${SESSION_KEY_PREFIX}${id}`);
  }
}

export async function saveArchiveSession(session: ArchiveSession): Promise<SaveArchiveResult> {
  const index = await loadArchiveIndex();
  const key = archiveKey(session.source, session.externalId);
  const sameKeyEntries = index.filter(
    (entry) => archiveKey(entry.source, entry.externalId) === key,
  );
  const reusedId = sameKeyEntries[0]?.id ?? session.id;
  const overwritten = sameKeyEntries.length > 0;

  for (const entry of sameKeyEntries) {
    if (entry.id !== reusedId) {
      try {
        await removeArchiveSessionFile(entry.id);
      } catch (error) {
        console.error("Failed to remove orphan archive session", error);
      }
    }
  }

  const toSave: ArchiveSession = { ...session, id: reusedId };
  const contents = JSON.stringify(toSave);
  if (isTauri()) {
    await invoke("write_chat_archive_session", { sessionId: toSave.id, contents });
  } else {
    window.localStorage.setItem(`${SESSION_KEY_PREFIX}${toSave.id}`, contents);
  }

  const item: ArchiveIndexItem = {
    id: toSave.id,
    source: toSave.source,
    externalId: toSave.externalId,
    title: toSave.title,
    cwd: toSave.cwd,
    sourcePath: toSave.sourcePath,
    createdAt: toSave.createdAt,
    updatedAt: toSave.updatedAt,
    importedAt: toSave.importedAt,
    messageCount: toSave.messages.length,
    assetCount: toSave.assetCount,
    usageTotal: toSave.usageTotal,
  };
  const nextIndex = sortByUpdatedAt([
    item,
    ...index.filter(
      (entry) => entry.id !== toSave.id && archiveKey(entry.source, entry.externalId) !== key,
    ),
  ]);
  const indexContents = JSON.stringify(nextIndex);
  if (isTauri()) {
    await invoke("write_chat_archive_index", { contents: indexContents });
  } else {
    window.localStorage.setItem(INDEX_KEY, indexContents);
  }

  return { overwritten, id: toSave.id };
}

export async function deleteArchiveSession(id: string): Promise<void> {
  if (isTauri()) {
    await invoke("delete_chat_archive_session", { sessionId: id });
    const index = await loadArchiveIndex();
    await invoke("write_chat_archive_index", {
      contents: JSON.stringify(index.filter((entry) => entry.id !== id)),
    });
  } else {
    window.localStorage.removeItem(`${SESSION_KEY_PREFIX}${id}`);
    const index = await loadArchiveIndex();
    window.localStorage.setItem(
      INDEX_KEY,
      JSON.stringify(index.filter((entry) => entry.id !== id)),
    );
  }
}

export async function findArchiveByExternal(
  source: ImportedArchiveSource,
  externalId: string,
): Promise<ArchiveIndexItem | undefined> {
  const index = await loadArchiveIndex();
  return index.find((item) => item.source === source && item.externalId === externalId);
}

export async function scanCodexSessions(): Promise<ScannedSession[]> {
  if (!isTauri()) return [];
  const items = await invoke<unknown>("scan_codex_sessions");
  return Array.isArray(items) ? items.filter(isScannedSession) : [];
}

export async function scanClaudeSessions(): Promise<ScannedSession[]> {
  if (!isTauri()) return [];
  const items = await invoke<unknown>("scan_claude_sessions");
  return Array.isArray(items) ? items.filter(isScannedSession) : [];
}

export async function readImportTextFile(path: string): Promise<string> {
  if (!isTauri()) {
    throw new Error("导入仅在桌面应用中可用");
  }
  return invoke<string>("read_text_file", { path });
}

export async function pathExists(path: string): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    return await invoke<boolean>("path_exists", { path });
  } catch {
    return false;
  }
}

export function sourceLabel(source: ArchiveSource) {
  switch (source) {
    case "native":
      return "本机";
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
  }
}
