import type { UIMessage } from "ai";
import {
  deleteChatServerSession,
  initializeChatServer,
  loadChatServerSession,
  loadChatServerSessions,
  saveChatServerSession,
  uploadChatServerAttachment,
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

function sortIndex(items: ChatIndexItem[]) {
  return [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  const messageIds = new Set<string>();
  const messages = value.messages.map((message, index) => {
    const source =
      message && typeof message === "object"
        ? message
        : ({ id: "", role: "assistant", parts: [] } as UIMessage);
    const candidate = typeof source.id === "string" ? source.id.trim() : "";
    let id = candidate && !messageIds.has(candidate) ? candidate : `legacy-message-${index}`;
    while (messageIds.has(id)) id = `${id}-duplicate`;
    messageIds.add(id);
    return {
      ...source,
      id,
      parts: Array.isArray(source.parts)
        ? source.parts.filter(
            (part) => part && typeof part === "object" && typeof part.type === "string",
          )
        : [],
    };
  });
  return {
    ...value,
    schemaVersion: CHAT_SCHEMA_VERSION,
    messages,
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
  await initializeChatServer();
  const serverItems = await loadChatServerSessions();
  return sortIndex(serverItems);
}

export async function loadChatSession(id: string): Promise<ChatSession | null> {
  await initializeChatServer();
  const serverSession = await loadChatServerSession<ChatSession>(id);
  return serverSession ? normalizeChatSession(serverSession) : null;
}

export async function saveChatSession(session: ChatSession): Promise<void> {
  await initializeChatServer();
  await saveChatServerSession(session);
}

export async function deleteChatSession(id: string): Promise<void> {
  await initializeChatServer();
  await deleteChatServerSession(id);
}

export async function writeChatAttachment(
  sessionId: string,
  attachmentId: string,
  bytes: Uint8Array,
  fileName: string,
): Promise<string | null> {
  const result = await uploadChatServerAttachment(sessionId, attachmentId, fileName, bytes);
  return result.path;
}
