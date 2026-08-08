import type { UIMessage } from "ai";

export const CHAT_SCHEMA_VERSION = 2 as const;
export const SESSION_STATUSES = [
  "idle",
  "submitted",
  "streaming",
  "error",
  "ready",
] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];

export type ServerModelConfig = {
  id?: string;
  name: string;
  provider?: string;
  baseUrl: string;
  apiKey: string;
  responsive?: boolean;
  supportsTools?: boolean;
};

export type ChatAttachment = Record<string, unknown>;

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

export type SessionIndexItem = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  attachmentCount: number;
  workspaceId?: string;
  cwd?: string;
  status: SessionStatus;
};

export type RunStartInput = {
  messages?: UIMessage[];
  message?: UIMessage;
  model: ServerModelConfig;
  system?: string;
  memory?: string;
  cwd?: string;
  workspaceId?: string;
  title?: string;
  toolNames?: string[];
};

export type ServerEvent = {
  id: string;
  type: "session.status" | "message.delta" | "message.updated" | "run.error" | "run.done";
  sessionId: string;
  runId?: string;
  status?: SessionStatus;
  messageId?: string;
  delta?: string;
  message?: UIMessage;
  error?: string;
  timestamp: string;
};

export type HealthResponse = {
  ok: true;
  host: string;
  port: number;
  version: string;
  activeRuns: number;
};

export function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && SESSION_STATUSES.includes(value as SessionStatus);
}

export function textFromMessage(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

export function deriveTitle(messages: UIMessage[]): string {
  const text = messages
    .filter((message) => message.role === "user")
    .map(textFromMessage)
    .find((value) => value.trim());
  if (!text) return "新对话";
  const normalized = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  return chars.slice(0, 40).join("") + (chars.length > 40 ? "…" : "");
}
