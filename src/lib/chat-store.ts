import { invoke } from "@tauri-apps/api/core";
import type { UIMessage } from "ai";
import {
  deleteChatServerSession,
  getChatServerToken,
  loadChatServerSession,
  loadChatServerSessions,
  saveChatServerSession,
} from "@/lib/chat-server";

export const CHAT_SCHEMA_VERSION = 2;

export type ChatAttachmentKind = "image" | "video" | "audio" | "file";
export type ChatAttachmentSource = "upload" | "generated" | "remote";

export type ChatAttachment = {
  id: string;
  kind: ChatAttachmentKind;
  mediaType: string;
  fileName?: string;
  size?: number;
  width?: number;
  height?: number;
  durationMs?: number;
  path: string;
  source: ChatAttachmentSource;
  createdAt: string;
};

export type ChatSession = {
  schemaVersion: typeof CHAT_SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  modelId?: string;
  workspaceId?: string;
  cwd?: string;
  mcpServerIds?: string[];
  skillIds?: string[];
  messages: UIMessage[];
  attachments: ChatAttachment[];
};

export type ChatIndexItem = Pick<ChatSession, "id" | "title" | "createdAt" | "updatedAt"> & {
  messageCount: number;
  attachmentCount: number;
  workspaceId?: string;
  cwd?: string;
};

const INDEX_KEY = "m-dashboard-chat-index-v1";
const SESSION_KEY_PREFIX = "m-dashboard-chat-session-";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function sortIndex(items: ChatIndexItem[]) {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isChatIndexItem(value: unknown): value is ChatIndexItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChatIndexItem>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string" &&
    typeof item.messageCount === "number" &&
    typeof item.attachmentCount === "number" &&
    (item.workspaceId === undefined || typeof item.workspaceId === "string") &&
    (item.cwd === undefined || typeof item.cwd === "string")
  );
}

function isChatAttachment(value: unknown): value is ChatAttachment {
  if (!value || typeof value !== "object") return false;
  const attachment = value as Partial<ChatAttachment>;
  return (
    typeof attachment.id === "string" &&
    typeof attachment.kind === "string" &&
    typeof attachment.mediaType === "string" &&
    typeof attachment.path === "string" &&
    typeof attachment.source === "string" &&
    typeof attachment.createdAt === "string"
  );
}

function isChatSession(value: unknown): value is ChatSession {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<ChatSession>;
  return (
    (session.schemaVersion === CHAT_SCHEMA_VERSION || session.schemaVersion === 1) &&
    typeof session.id === "string" &&
    typeof session.title === "string" &&
    typeof session.createdAt === "string" &&
    typeof session.updatedAt === "string" &&
    Array.isArray(session.messages) &&
    Array.isArray(session.attachments) &&
    session.attachments.every(isChatAttachment)
  );
}

function normalizeChatSession(value: unknown): ChatSession | null {
  if (!isChatSession(value)) return null;
  return {
    ...value,
    schemaVersion: CHAT_SCHEMA_VERSION,
    workspaceId: typeof value.workspaceId === "string" ? value.workspaceId : undefined,
    cwd: typeof value.cwd === "string" ? value.cwd : undefined,
    mcpServerIds: Array.isArray(value.mcpServerIds)
      ? value.mcpServerIds.filter((item): item is string => typeof item === "string")
      : undefined,
    skillIds: Array.isArray(value.skillIds)
      ? value.skillIds.filter((item): item is string => typeof item === "string")
      : undefined,
  };
}

export function createSessionId() {
  return crypto.randomUUID() as string;
}

export function deriveChatTitle(messages: UIMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user");
  const text = firstUserMessage?.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "新对话";
  return Array.from(text).slice(0, 40).join("") + (Array.from(text).length > 40 ? "…" : "");
}

export async function loadChatIndex(): Promise<ChatIndexItem[]> {
  if (getChatServerToken()) {
    try {
      const serverItems = await loadChatServerSessions();
      return sortIndex(serverItems);
    } catch (error) {
      console.error("Failed to load Chat Server index", error);
    }
  }
  try {
    const contents = isTauri() ? await invoke<string>("read_chat_index") : null;
    const parsed = parseJson<unknown>(contents ?? window.localStorage.getItem(INDEX_KEY), []);
    return sortIndex(Array.isArray(parsed) ? parsed.filter(isChatIndexItem) : []);
  } catch (error) {
    console.error("Failed to load chat index", error);
    const fallback = parseJson<unknown>(window.localStorage.getItem(INDEX_KEY), []);
    return sortIndex(Array.isArray(fallback) ? fallback.filter(isChatIndexItem) : []);
  }
}

export async function loadChatSession(id: string): Promise<ChatSession | null> {
  if (getChatServerToken()) {
    try {
      const serverSession = await loadChatServerSession<ChatSession>(id);
      if (serverSession) return normalizeChatSession(serverSession);
    } catch (error) {
      console.error("Failed to load Chat Server session", error);
    }
  }
  try {
    const contents = isTauri()
      ? await invoke<string | null>("read_chat_session", { sessionId: id })
      : window.localStorage.getItem(`${SESSION_KEY_PREFIX}${id}`);
    const parsed = parseJson<unknown>(contents, null);
    return normalizeChatSession(parsed);
  } catch (error) {
    console.error("Failed to load chat session", error);
    return null;
  }
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  if (getChatServerToken()) {
    try {
      await saveChatServerSession(session);
      return;
    } catch (error) {
      console.error("Failed to save Chat Server session", error);
    }
  }
  const contents = JSON.stringify(session);
  if (isTauri()) {
    await invoke("write_chat_session", { sessionId: session.id, contents });
  } else {
    window.localStorage.setItem(`${SESSION_KEY_PREFIX}${session.id}`, contents);
  }

  const index = await loadChatIndex();
  const item: ChatIndexItem = {
    id: session.id,
    title: session.title,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    workspaceId: session.workspaceId,
    cwd: session.cwd,
    messageCount: session.messages.length,
    attachmentCount: session.attachments.length,
  };
  const nextIndex = sortIndex([item, ...index.filter((entry) => entry.id !== session.id)]);
  const indexContents = JSON.stringify(nextIndex);
  if (isTauri()) {
    await invoke("write_chat_index", { contents: indexContents });
  } else {
    window.localStorage.setItem(INDEX_KEY, indexContents);
  }
}

export async function deleteChatSession(id: string): Promise<void> {
  if (getChatServerToken()) {
    try {
      await deleteChatServerSession(id);
      return;
    } catch (error) {
      console.error("Failed to delete Chat Server session", error);
    }
  }
  if (isTauri()) {
    await invoke("delete_chat_session", { sessionId: id });
    const index = await loadChatIndex();
    await invoke("write_chat_index", {
      contents: JSON.stringify(index.filter((entry) => entry.id !== id)),
    });
  } else {
    window.localStorage.removeItem(`${SESSION_KEY_PREFIX}${id}`);
    const index = await loadChatIndex();
    window.localStorage.setItem(
      INDEX_KEY,
      JSON.stringify(index.filter((entry) => entry.id !== id)),
    );
  }
}

export async function writeChatAttachment(
  sessionId: string,
  attachmentId: string,
  bytes: Uint8Array,
  fileName: string,
): Promise<string | null> {
  if (isTauri()) {
    return invoke<string>("write_chat_attachment", {
      sessionId,
      attachmentId,
      fileName,
      bytes: Array.from(bytes),
    });
  }
  return null;
}
