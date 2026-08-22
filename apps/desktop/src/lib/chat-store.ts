import type {
  ChatAttachment,
  ChatAttachmentKind,
  ChatAttachmentSource,
  ChatIndexItem,
  ChatSession,
  SandboxMode,
} from "@chatdesk/shared";
import { CHAT_SCHEMA_VERSION, DEFAULT_WORKSPACE_ID, deriveTitle } from "@chatdesk/shared";
import type { UIMessage } from "ai";
import {
  deleteChatServerSession,
  downloadChatServerAttachment,
  initializeChatServer,
  loadChatServerSession,
  loadChatServerSessions,
  saveChatServerSession,
  uploadChatServerAttachment,
} from "@/lib/chat-server";
import { joinTaskCwd } from "./workspace-path";
import { loadWorkspaceProjects } from "./workspaces";

export type {
  ChatAttachment,
  ChatAttachmentKind,
  ChatAttachmentSource,
  ChatIndexItem,
  ChatSession,
};
export { CHAT_SCHEMA_VERSION };
export type ChatSandboxMode = SandboxMode;

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
    sandboxMode:
      value.sandboxMode === "auto" || value.sandboxMode === "full" ? value.sandboxMode : "ask",
    mcpServerIds: Array.isArray(value.mcpServerIds)
      ? value.mcpServerIds.filter((item): item is string => typeof item === "string")
      : undefined,
    skillIds: Array.isArray(value.skillIds)
      ? value.skillIds.filter((item): item is string => typeof item === "string")
      : undefined,
    planMode: value.planMode === "plan" ? "plan" : "apply",
    kind: value.kind === "task" ? "task" : "chat",
    parentSessionId: typeof value.parentSessionId === "string" ? value.parentSessionId : undefined,
    activePlanId: typeof value.activePlanId === "string" ? value.activePlanId : undefined,
    plans: Array.isArray(value.plans)
      ? value.plans.filter((item): item is NonNullable<ChatSession["plans"]>[number] =>
          Boolean(
            item &&
              typeof item === "object" &&
              typeof (item as { id?: unknown }).id === "string" &&
              typeof (item as { fileName?: unknown }).fileName === "string" &&
              typeof (item as { createdAt?: unknown }).createdAt === "string" &&
              typeof (item as { updatedAt?: unknown }).updatedAt === "string",
          ),
        )
      : undefined,
  };
}

export function createSessionId() {
  return crypto.randomUUID() as string;
}

export const deriveChatTitle = deriveTitle;

export async function loadChatIndex(): Promise<ChatIndexItem[]> {
  await initializeChatServer();
  const serverItems = await loadChatServerSessions();
  return sortIndex(serverItems);
}

export function filterChatSearchResponse(
  items: Array<ChatIndexItem & { searchRelevance?: number }>,
  query?: string,
) {
  if (!query?.trim()) return items;
  return items.filter((item) => typeof item.searchRelevance === "number");
}

export async function searchChatIndex(options: {
  query?: string;
  limit: number;
}): Promise<ChatIndexItem[]> {
  await initializeChatServer();
  const serverItems = await loadChatServerSessions(options);
  return filterChatSearchResponse(serverItems, options.query);
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

export async function clearChatSessionWorkspace(id: string): Promise<void> {
  await initializeChatServer();
  const session = await loadChatServerSession<ChatSession>(id);
  if (!session) return;
  const projects = await loadWorkspaceProjects();
  const root = projects.find((project) => project.id === DEFAULT_WORKSPACE_ID)?.path;
  await saveChatServerSession({
    ...session,
    workspaceId: DEFAULT_WORKSPACE_ID,
    cwd: root ? joinTaskCwd(root, id) : session.cwd,
  } as unknown as ChatSession);
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
) {
  return uploadChatServerAttachment(sessionId, attachmentId, fileName, bytes);
}

export async function readChatAttachment(sessionId: string, attachmentId: string) {
  return downloadChatServerAttachment(sessionId, attachmentId);
}
