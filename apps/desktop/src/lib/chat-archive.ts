import {
  chatServerRequest,
  deleteChatServerArchive,
  loadChatServerArchive,
  loadChatServerArchiveIndex,
  saveChatServerArchive,
  uploadChatServerArchive,
} from "@/lib/chat-server";

export const ARCHIVE_SCHEMA_VERSION = 1;

export type ArchiveSource = "codex" | "claude-code" | "cursor" | "kimi" | "native";
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

function sortByUpdatedAt<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function isImportedSource(value: unknown): value is ImportedArchiveSource {
  return value === "codex" || value === "claude-code" || value === "cursor" || value === "kimi";
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
    const parsed = await loadChatServerArchiveIndex();
    return sortByUpdatedAt(Array.isArray(parsed) ? parsed.filter(isArchiveIndexItem) : []);
  } catch (error) {
    console.error("Failed to load chat archive index", error);
    return [];
  }
}

export async function loadArchiveSession(id: string): Promise<ArchiveSession | null> {
  try {
    const parsed = await loadChatServerArchive<ArchiveSession>(id);
    return isArchiveSession(parsed) ? parsed : null;
  } catch (error) {
    console.error("Failed to load chat archive session", error);
    return null;
  }
}

async function removeArchiveSessionFile(id: string): Promise<void> {
  await deleteChatServerArchive(id);
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
  await saveChatServerArchive(toSave);

  return { overwritten, id: toSave.id };
}

export async function deleteArchiveSession(id: string): Promise<void> {
  await deleteChatServerArchive(id);
}

export async function findArchiveByExternal(
  source: ImportedArchiveSource,
  externalId: string,
): Promise<ArchiveIndexItem | undefined> {
  const index = await loadArchiveIndex();
  return index.find((item) => item.source === source && item.externalId === externalId);
}

export async function scanCodexSessions(): Promise<ScannedSession[]> {
  const response = await chatServerRequest("/v1/archive/scan/codex", { method: "POST" });
  const items = (await response.json()) as unknown;
  return Array.isArray(items) ? items.filter(isScannedSession) : [];
}

export async function scanClaudeSessions(): Promise<ScannedSession[]> {
  const response = await chatServerRequest("/v1/archive/scan/claude-code", { method: "POST" });
  const items = (await response.json()) as unknown;
  return Array.isArray(items) ? items.filter(isScannedSession) : [];
}

export async function scanCursorSessions(): Promise<ScannedSession[]> {
  const response = await chatServerRequest("/v1/archive/scan/cursor", { method: "POST" });
  const items = (await response.json()) as unknown;
  return Array.isArray(items) ? items.filter(isScannedSession) : [];
}

export async function scanKimiSessions(): Promise<ScannedSession[]> {
  const response = await chatServerRequest("/v1/archive/scan/kimi", { method: "POST" });
  const items = (await response.json()) as unknown;
  return Array.isArray(items) ? items.filter(isScannedSession) : [];
}

export async function readImportTextFile(
  path: string,
  source?: ImportedArchiveSource,
): Promise<string> {
  const response = await chatServerRequest(
    source === "cursor" ? "/v1/archive/read-cursor" : "/v1/archive/read-file",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    },
  );
  if (!response.ok) throw new Error((await response.text()) || "无法读取导入文件");
  return response.text();
}

export async function uploadImportFile(source: ImportedArchiveSource, file: File) {
  return uploadChatServerArchive(source, file);
}

export async function pathExists(path: string): Promise<boolean> {
  const response = await chatServerRequest("/v1/archive/path-exists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return response.ok && ((await response.json()) as { exists?: boolean }).exists === true;
}

export function sourceLabel(source: ArchiveSource) {
  switch (source) {
    case "native":
      return "本机";
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
    case "cursor":
      return "Cursor";
    case "kimi":
      return "Kimi";
  }
}
