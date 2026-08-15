import type { UIMessage } from "ai";

export const CHAT_SCHEMA_VERSION = 2 as const;
export const MAX_AGENT_STEPS = 100;
export const SESSION_STATUSES = ["idle", "submitted", "streaming", "error", "ready"] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type SandboxMode = "ask" | "auto" | "full";
export type ChatPlanMode = "plan" | "apply";

export type ChatPlanSummary = {
  id: string;
  fileName: string;
  createdAt: string;
  updatedAt: string;
};

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
  planMode?: ChatPlanMode;
  activePlanId?: string;
  plans?: ChatPlanSummary[];
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
  inputContext?: number;
};

export type ChatTokenUsage = {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningOutputTokens?: number;
};

export const DEFAULT_MODEL_CONTEXT_WINDOW = 128_000;
export const CONTEXT_COMPACTION_RATIO = 0.75;

export type ChatRunOutcome = "completed" | "awaiting-user" | "stopped" | "error";
export type ChatRunStopReason =
  | "user"
  | "tool-loop"
  | "step-limit"
  | "incomplete-response"
  | "checkpoint-failed"
  | "context-limit"
  | "server-restarted";
export type ChatRunPhase = "working" | "compacting" | "finalizing";

export type ChatRunSummary = {
  runId: string;
  outcome: ChatRunOutcome;
  stopReason?: ChatRunStopReason;
  stepCount: number;
  modelCallCount: number;
  toolCallCount: number;
  duplicateToolCallCount: number;
  compactionCount: number;
  planWritten: boolean;
};

export type ChatRunProgress = Omit<ChatRunSummary, "outcome" | "stopReason"> & {
  phase: ChatRunPhase;
  planMode: ChatPlanMode;
  stopReason?: ChatRunStopReason;
};

export type ChatContextCompaction = {
  count: number;
  stepNumber: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
};

export type ChatContextUsage = {
  inputTokens: number;
  source: "provider" | "estimate";
  stepNumber: number;
};

export function resolveModelContextWindow(inputContext: number | undefined) {
  return inputContext && Number.isFinite(inputContext) && inputContext > 0
    ? inputContext
    : DEFAULT_MODEL_CONTEXT_WINDOW;
}

export function resolveContextCompactionThreshold(inputContext: number | undefined) {
  return Math.floor(resolveModelContextWindow(inputContext) * CONTEXT_COMPACTION_RATIO);
}

export const DEVELOPMENT_TOOL_NAMES = [
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "corepack",
  "bun",
  "deno",
  "python3",
  "python",
  "pip3",
  "pip",
  "uv",
  "poetry",
  "go",
  "rustc",
  "cargo",
  "rustup",
  "java",
  "javac",
  "mvn",
  "gradle",
  "kotlin",
  "kotlinc",
  "dotnet",
  "make",
  "cmake",
  "ninja",
  "clang",
  "clang++",
  "gcc",
  "g++",
  "git",
  "rg",
  "gh",
  "docker",
  "kubectl",
  "helm",
  "terraform",
  "tofu",
  "ruby",
  "gem",
  "php",
  "composer",
  "swift",
  "xcodebuild",
  "pod",
  "flutter",
  "dart",
  "adb",
] as const;

export type DevelopmentToolName = (typeof DEVELOPMENT_TOOL_NAMES)[number];

export type DevelopmentToolStatus = {
  name: DevelopmentToolName;
  available: boolean;
  executable?: string;
  directory?: string;
};

export type DeveloperEnvironmentStatus = {
  shell: string;
  paths: string[];
  tools: DevelopmentToolStatus[];
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
  planMode?: ChatPlanMode;
  planId?: string;
};

export const TODO_TOOL_NAME = "todo_write";

export const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;

export type TodoStatus = (typeof TODO_STATUSES)[number];

export type TodoItem = {
  content: string;
  status: TodoStatus;
  activeForm?: string;
};

/** 从未知输入中提取合法 todo 列表；非法时返回 null（供服务端工具与前端面板共用）。 */
export function parseTodoList(value: unknown): TodoItem[] | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { todos?: unknown };
  if (!Array.isArray(record.todos) || record.todos.length === 0 || record.todos.length > 30) {
    return null;
  }
  const items: TodoItem[] = [];
  for (const entry of record.todos) {
    if (!entry || typeof entry !== "object") return null;
    const item = entry as { content?: unknown; status?: unknown; activeForm?: unknown };
    if (typeof item.content !== "string" || !item.content.trim() || item.content.length > 200) {
      return null;
    }
    if (typeof item.status !== "string" || !TODO_STATUSES.includes(item.status as TodoStatus)) {
      return null;
    }
    const todo: TodoItem = { content: item.content, status: item.status as TodoStatus };
    if (typeof item.activeForm === "string" && item.activeForm.trim().length <= 100) {
      todo.activeForm = item.activeForm;
    }
    items.push(todo);
  }
  return items;
}

export type ServerEvent = {
  id: string;
  type:
    | "session.status"
    | "message.delta"
    | "message.updated"
    | "context.compacted"
    | "context.usage"
    | "run.progress"
    | "run.error"
    | "run.done"
    | "plan.updated";
  sessionId: string;
  runId?: string;
  status?: SessionStatus;
  messageId?: string;
  delta?: string;
  message?: UIMessage;
  error?: string;
  contextCompaction?: ChatContextCompaction;
  contextUsage?: ChatContextUsage;
  runProgress?: ChatRunProgress;
  runSummary?: ChatRunSummary;
  planId?: string;
  planFileName?: string;
  planContent?: string;
  planUpdatedAt?: string;
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
  sandboxReadablePaths: string[];
  developerToolPaths: string[];
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
  command?: string;
  input?: Record<string, unknown>;
  reasons: string[];
  decision: "approve" | "deny" | "user-approval";
  rationale?: string;
  reason?: string;
  modelId?: string;
  durationMs?: number;
  usage?: ChatTokenUsage;
  error?: string;
};

export type ChatServerAiUsageLog = {
  id: string;
  timestamp: string;
  operation: string;
  modelId?: string;
  provider?: string;
  model?: string;
  sessionId?: string;
  runId?: string;
  callId?: string;
  invocationIndex?: number;
  providerModelId?: string;
  responseId?: string;
  usage: ChatTokenUsage;
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

export type WorkspaceGitFile = {
  path: string;
  previousPath?: string;
  status: "added" | "modified" | "deleted" | "renamed" | "untracked" | "conflicted";
  additions: number | null;
  deletions: number | null;
  binary?: boolean;
};

export type WorkspaceFileEntry = {
  name: string;
  path: string;
  kind: "dir" | "file" | "other";
};

export type WorkspaceListResult = {
  path: string;
  entries: WorkspaceFileEntry[];
};

export type WorkspaceGitDiff = {
  path: string;
  previousPath?: string;
  content: string;
  originalContent?: string;
  modifiedContent?: string;
  additions: number | null;
  deletions: number | null;
  binary?: boolean;
  truncated?: boolean;
};

export type WorkspaceGitSummary = {
  branch: string | null;
  upstream?: string | null;
  ahead: number;
  behind: number;
  insertions: number;
  deletions: number;
  filesChanged: number;
  files: WorkspaceGitFile[];
  truncated?: boolean;
};

export type WorkspaceGitCommitResult = {
  hash: string;
  message: string;
  pushed: boolean;
  generated: boolean;
};

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
