import type { UIMessage } from "ai";

export const CHAT_SCHEMA_VERSION = 2 as const;
export const SESSION_STATUSES = ["idle", "submitted", "streaming", "error", "ready"] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type SandboxMode = "ask" | "auto" | "full";

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

export type SystemPromptSection = {
  id: string;
  label: string;
  content: string;
  included: boolean;
  path?: string;
};

export type SystemPromptSnapshot = {
  text: string;
  sections: SystemPromptSection[];
  cwd?: string;
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
  sandboxMode?: SandboxMode;
  mcpServerIds?: string[];
  skillIds?: string[];
  systemPrompt?: SystemPromptSnapshot;
  messages: UIMessage[];
  attachments: ChatAttachment[];
};

export type ChatIndexItem = Pick<
  ChatSession,
  "id" | "title" | "createdAt" | "updatedAt" | "workspaceId" | "cwd"
> & {
  messageCount: number;
  attachmentCount: number;
};

export type SessionIndexItem = ChatIndexItem & {
  status: SessionStatus;
};

export type ServerModelConfig = {
  id?: string;
  name: string;
  provider?: string;
  baseUrl: string;
  apiKey?: string;
  responsive?: boolean;
  supportsTools?: boolean;
  supportsReasoning?: boolean;
};

export type RunStartInput = {
  messages?: UIMessage[];
  message?: UIMessage;
  model?: ServerModelConfig;
  modelId?: string;
  system?: string;
  memory?: string;
  cwd?: string;
  workspaceId?: string;
  sandboxMode?: SandboxMode;
  mcpServerIds?: string[];
  skillIds?: string[];
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

export type ChatServerConfigData = {
  models: unknown[];
  chatTools: Record<string, boolean>;
  sandboxMode: SandboxMode;
  approvalReviewerModelId?: string;
  mcpServers: unknown[];
  installedSkillIds: string[];
  selectedSkillIds: string[];
  apiKeys: Record<string, string>;
};

export type ChatServerProviderModel = {
  id: string;
  contextLength?: number;
  supportsImageIn?: boolean;
  supportsVideoIn?: boolean;
  supportsReasoning?: boolean;
};

export type ChatServerReviewerLog = {
  id: string;
  timestamp: string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  toolName?: string;
  reasons: string[];
  decision: "approve" | "deny" | "user-approval";
  rationale?: string;
  reason?: string;
  modelId?: string;
  durationMs?: number;
  error?: string;
};

export type ChatToolPackId =
  | "list_dir"
  | "search_files"
  | "read_file"
  | "write_file"
  | "edit_file"
  | "terminal"
  | "web_search"
  | "image_generation"
  | "browser";

export type ChatToolsSettings = Record<ChatToolPackId, boolean>;

export type ModelConfig = {
  id: string;
  name: string;
  provider: string;
  baseUrl: string;
  apiKey: string;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  customProtocol: boolean;
  responsive: boolean;
  inputContext?: number;
  outputContext?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cacheReadPricePerMillion?: number;
  cacheWritePricePerMillion?: number;
  isDefault: boolean;
};

export function isSessionStatus(value: unknown): value is SessionStatus {
  return typeof value === "string" && SESSION_STATUSES.includes(value as SessionStatus);
}

export function textFromMessage(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join(" ");
}

export function deriveTitle(messages: UIMessage[]) {
  const text = messages
    .filter((message) => message.role === "user")
    .map(textFromMessage)
    .find((value) => value.trim());
  if (!text) return "新对话";
  const normalized = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(normalized);
  return chars.slice(0, 40).join("") + (chars.length > 40 ? "…" : "");
}
