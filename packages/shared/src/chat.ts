import { getToolName, isToolUIPart, type UIMessage } from "ai";

export const CHAT_SCHEMA_VERSION = 2 as const;
export const DEFAULT_WORKSPACE_ID = "default";
export const DEFAULT_WORKSPACE_NAME = "Default Workspace";
export const MAX_AGENT_STEPS = 100;
export const SESSION_STATUSES = ["idle", "submitted", "streaming", "error", "ready"] as const;

export type SessionStatus = (typeof SESSION_STATUSES)[number];
export type SandboxMode = "ask" | "auto" | "full";
export type ChatPlanMode = "plan" | "apply";

export const PLAN_USER_INPUT_TOOL_NAME = "request_user_input";

export type PlanUserInputOption = {
  id: string;
  label: string;
  description?: string;
};

export type PlanUserInputQuestion = {
  id: string;
  header: string;
  question: string;
  options: PlanUserInputOption[];
  recommendedOptionId: string;
};

export type PlanUserInputRequest = {
  questions: PlanUserInputQuestion[];
};

export type PlanUserInputAnswer = {
  questionId: string;
  answer: string;
  optionId?: string;
  custom: boolean;
};

export type PlanUserInputResponse = {
  answers: PlanUserInputAnswer[];
};

function boundedString(value: unknown, maxLength: number) {
  return typeof value === "string" && value.trim() && value.length <= maxLength
    ? value.trim()
    : null;
}

export function parsePlanUserInputRequest(value: unknown): PlanUserInputRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const questions = (value as { questions?: unknown }).questions;
  if (!Array.isArray(questions) || questions.length < 1 || questions.length > 3) return null;

  const questionIds = new Set<string>();
  const parsedQuestions: PlanUserInputQuestion[] = [];
  for (const value of questions) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const question = value as Record<string, unknown>;
    const id = boundedString(question.id, 64);
    const header = boundedString(question.header, 32);
    const prompt = boundedString(question.question, 500);
    if (!id || !header || !prompt || questionIds.has(id)) return null;
    if (
      !Array.isArray(question.options) ||
      question.options.length < 2 ||
      question.options.length > 4
    )
      return null;

    const optionIds = new Set<string>();
    const options: PlanUserInputOption[] = [];
    for (const value of question.options) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const option = value as Record<string, unknown>;
      const optionId = boundedString(option.id, 64);
      const label = boundedString(option.label, 120);
      if (!optionId || !label || optionIds.has(optionId)) return null;
      const description =
        option.description === undefined ? undefined : boundedString(option.description, 240);
      if (option.description !== undefined && !description) return null;
      optionIds.add(optionId);
      options.push({ id: optionId, label, ...(description ? { description } : {}) });
    }

    const recommendedOptionId = boundedString(question.recommendedOptionId, 64);
    if (!recommendedOptionId || !optionIds.has(recommendedOptionId)) return null;
    questionIds.add(id);
    parsedQuestions.push({
      id,
      header,
      question: prompt,
      options,
      recommendedOptionId,
    });
  }
  return { questions: parsedQuestions };
}

export function parsePlanUserInputResponse(value: unknown): PlanUserInputResponse | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const answers = (value as { answers?: unknown }).answers;
  if (!Array.isArray(answers) || answers.length < 1 || answers.length > 3) return null;
  const questionIds = new Set<string>();
  const parsedAnswers: PlanUserInputAnswer[] = [];
  for (const value of answers) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const answer = value as Record<string, unknown>;
    const questionId = boundedString(answer.questionId, 64);
    const text = boundedString(answer.answer, 1_000);
    if (!questionId || !text || questionIds.has(questionId) || typeof answer.custom !== "boolean")
      return null;
    const optionId = answer.optionId === undefined ? undefined : boundedString(answer.optionId, 64);
    if ((!answer.custom && !optionId) || (answer.custom && answer.optionId !== undefined))
      return null;
    questionIds.add(questionId);
    parsedAnswers.push({
      questionId,
      answer: text,
      ...(optionId ? { optionId } : {}),
      custom: answer.custom,
    });
  }
  return { answers: parsedAnswers };
}

export function sortPlanUserInputOptions(question: PlanUserInputQuestion) {
  return [...question.options].sort((left, right) => {
    if (left.id === question.recommendedOptionId) return -1;
    if (right.id === question.recommendedOptionId) return 1;
    return 0;
  });
}

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

export const CHAT_SESSION_KINDS = ["chat", "task"] as const;
export type ChatSessionKind = (typeof CHAT_SESSION_KINDS)[number];

export type ChatSession = {
  schemaVersion: typeof CHAT_SCHEMA_VERSION;
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  kind?: ChatSessionKind;
  parentSessionId?: string;
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
  "id" | "title" | "createdAt" | "updatedAt" | "workspaceId" | "cwd" | "kind" | "parentSessionId"
> & {
  messageCount: number;
  attachmentCount: number;
};

export type SessionIndexItem = ChatIndexItem & {
  status: SessionStatus;
  lastRunSummary?: ChatRunSummary;
  runStartedAt?: string;
  searchRelevance?: number;
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
export const MAX_CONTEXT_COMPACTION_TOKENS = 750_000;

export type ChatRunOutcome = "completed" | "awaiting-user" | "stopped" | "error";
export type ChatRunStopReason =
  | "user"
  | "tool-loop"
  | "step-limit"
  | "incomplete-response"
  | "checkpoint-failed"
  | "context-limit"
  | "tool-errors"
  | "server-restarted";
export type ChatRunPhase = "working" | "compacting" | "finalizing";
export type ChatTaskStatus = "complete" | "partial" | "unknown";

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
  failedToolCallCount?: number;
  truncatedToolResultCount?: number;
  taskStatus?: ChatTaskStatus;
  touchedPaths?: string[];
  startedAt?: string;
  durationMs?: number;
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
  return Math.min(
    MAX_CONTEXT_COMPACTION_TOKENS,
    Math.floor(resolveModelContextWindow(inputContext) * CONTEXT_COMPACTION_RATIO),
  );
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
export const CREATE_TASK_TOOL_NAME = "create_task";
export const CREATE_TASK_STATUSES = ["running", "completed", "error", "stopped"] as const;
export type CreateTaskStatus = (typeof CREATE_TASK_STATUSES)[number];

export type CreateTaskPreviewMessage = {
  role: "user" | "assistant";
  text: string;
};

export type CreateTaskToolGlance = {
  name: string;
  detail?: string;
  pending?: boolean;
};

export type CreateTaskProgress = {
  headings: string[];
  tools: CreateTaskToolGlance[];
};

export type CreateTaskOutput = {
  sessionId: string;
  title: string;
  status: CreateTaskStatus;
  preview: string;
  headings?: string[];
  tools?: CreateTaskToolGlance[];
  outcome?: ChatRunOutcome;
  error?: string;
  messages?: CreateTaskPreviewMessage[];
};

const TASK_PROGRESS_HEADING_LIMIT = 6;
const TASK_PROGRESS_TOOL_LIMIT = 8;
const TASK_PROGRESS_TEXT_MAX = 72;

const CHAT_RUN_OUTCOMES = ["completed", "awaiting-user", "stopped", "error"] as const;

function isCreateTaskStatus(value: unknown): value is CreateTaskStatus {
  return typeof value === "string" && CREATE_TASK_STATUSES.includes(value as CreateTaskStatus);
}

function isChatRunOutcome(value: unknown): value is ChatRunOutcome {
  return typeof value === "string" && CHAT_RUN_OUTCOMES.includes(value as ChatRunOutcome);
}

export function parseCreateTaskOutput(value: unknown): CreateTaskOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const sessionId = boundedString(record.sessionId, 128);
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const preview = typeof record.preview === "string" ? record.preview : "";
  if (!sessionId || !title || !isCreateTaskStatus(record.status)) return null;

  const parsed: CreateTaskOutput = {
    sessionId,
    title,
    status: record.status,
    preview,
  };
  if (isChatRunOutcome(record.outcome)) parsed.outcome = record.outcome;
  if (typeof record.error === "string" && record.error.trim()) parsed.error = record.error.trim();
  const headings = parseCreateTaskHeadings(record.headings);
  if (headings.length > 0) parsed.headings = headings;
  const tools = parseCreateTaskTools(record.tools);
  if (tools.length > 0) parsed.tools = tools;
  if (Array.isArray(record.messages)) {
    const messages: CreateTaskPreviewMessage[] = [];
    for (const entry of record.messages) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const message = entry as Record<string, unknown>;
      if (
        (message.role !== "user" && message.role !== "assistant") ||
        typeof message.text !== "string"
      ) {
        continue;
      }
      messages.push({ role: message.role, text: message.text });
    }
    if (messages.length > 0) parsed.messages = messages;
  }
  return parsed;
}

function compactProgressText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateProgressText(value: string, maxLength = TASK_PROGRESS_TEXT_MAX) {
  const compact = compactProgressText(value);
  if (!compact || compact.length <= maxLength) return compact;
  return `${compact.slice(0, Math.max(1, maxLength - 1)).trimEnd()}…`;
}

function lastUniqueByKey<T>(items: T[], keyOf: (item: T) => string, limit: number) {
  const seen = new Set<string>();
  const selected: T[] = [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (!item) continue;
    const key = keyOf(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    selected.push(item);
    if (selected.length >= limit) break;
  }
  return selected.reverse();
}

function lastPathSegment(value: string) {
  const normalized = value.replace(/[\\/]+$/, "");
  const segments = normalized.split(/[\\/]/);
  return segments[segments.length - 1] || normalized;
}

function recordValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(value: unknown, key: string) {
  const record = recordValue(value);
  const property = record?.[key];
  return typeof property === "string" ? property.trim() : "";
}

function parseCreateTaskHeadings(value: unknown) {
  if (!Array.isArray(value)) return [];
  const headings: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const heading = truncateProgressText(entry);
    if (heading) headings.push(heading);
    if (headings.length >= TASK_PROGRESS_HEADING_LIMIT) break;
  }
  return headings;
}

function parseCreateTaskTools(value: unknown) {
  if (!Array.isArray(value)) return [];
  const tools: CreateTaskToolGlance[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const name = boundedString(record.name, 80);
    if (!name) continue;
    const detail = typeof record.detail === "string" ? truncateProgressText(record.detail) : "";
    const tool: CreateTaskToolGlance = { name };
    if (detail) tool.detail = detail;
    if (record.pending === true) tool.pending = true;
    tools.push(tool);
    if (tools.length >= TASK_PROGRESS_TOOL_LIMIT) break;
  }
  return tools;
}

export function extractMarkdownHeadings(text: string) {
  const headings: string[] = [];
  let inFence = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmedStart = rawLine.trimStart();
    if (trimmedStart.startsWith("```") || trimmedStart.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(rawLine.trim());
    if (!match?.[2]) continue;
    const heading = truncateProgressText(match[2]);
    if (heading) headings.push(heading);
  }
  return headings;
}

function toolGlanceDetail(name: string, input: unknown, output: unknown) {
  if (name === "bash") return stringField(input, "command");
  if (name === "search_files") {
    return stringField(input, "query") || stringField(input, "pattern");
  }
  if (name === "web_search") {
    return stringField(input, "query") || stringField(input, "search");
  }
  if (name === "apply_patch") {
    const changedFiles = recordValue(output)?.changedFiles;
    if (Array.isArray(changedFiles) && changedFiles.length > 0) {
      return `${changedFiles.length} 个文件`;
    }
    return "";
  }
  if (name === TODO_TOOL_NAME) {
    const todos = recordValue(input)?.todos;
    return Array.isArray(todos) && todos.length > 0 ? `${todos.length} 项` : "";
  }
  const path = stringField(output, "path") || stringField(input, "path");
  if (path) return lastPathSegment(path);
  return (
    stringField(input, "url") ||
    stringField(input, "query") ||
    stringField(input, "pattern") ||
    stringField(input, "command") ||
    stringField(input, "title")
  );
}

function toolGlanceFromPart(part: UIMessage["parts"][number]): CreateTaskToolGlance | null {
  if (!isToolUIPart(part)) return null;
  const name = getToolName(part).trim();
  if (!name || name === CREATE_TASK_TOOL_NAME) return null;
  const input = "input" in part ? part.input : undefined;
  const output = "output" in part ? part.output : undefined;
  const preliminary = "preliminary" in part ? Boolean(part.preliminary) : false;
  const pending =
    preliminary || part.state === "input-streaming" || part.state === "input-available";
  const detail = truncateProgressText(toolGlanceDetail(name, input, output));
  return {
    name,
    ...(detail ? { detail } : {}),
    ...(pending ? { pending: true } : {}),
  };
}

export function extractCreateTaskProgress(messages: UIMessage[]): CreateTaskProgress {
  const headings: string[] = [];
  const tools: CreateTaskToolGlance[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of message.parts) {
      if (part.type === "text" && typeof part.text === "string") {
        headings.push(...extractMarkdownHeadings(part.text));
      }
      const tool = toolGlanceFromPart(part);
      if (tool) tools.push(tool);
    }
  }
  return {
    headings: lastUniqueByKey(headings, (heading) => heading, TASK_PROGRESS_HEADING_LIMIT),
    tools: lastUniqueByKey(
      tools,
      (tool) => `${tool.name}\0${tool.detail ?? ""}`,
      TASK_PROGRESS_TOOL_LIMIT,
    ),
  };
}

export const TODO_STATUSES = ["pending", "in_progress", "completed", "blocked"] as const;

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
  disabledSkillIds: string[];
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
  | "browser"
  | "conversation_history";

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

export type WorkspacePathSuggestion = {
  path: string;
  kind: "dir" | "file";
};

export type WorkspacePathSuggestionResult = {
  suggestions: WorkspacePathSuggestion[];
  truncated: boolean;
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

function normalizeSearchText(value: string) {
  return value.normalize("NFKC").toLocaleLowerCase();
}

export function sessionSearchRelevance(
  session: Pick<ChatSession, "title" | "messages">,
  query: string,
) {
  const normalizedQuery = normalizeSearchText(query.trim());
  if (!normalizedQuery) return 0;

  const terms = normalizedQuery.split(/\s+/).filter(Boolean);
  const title = normalizeSearchText(session.title);
  const userMessages = session.messages
    .filter((message) => message.role === "user")
    .map((message) => normalizeSearchText(textFromMessage(message)));
  const searchableFields = [title, ...userMessages];
  if (!terms.every((term) => searchableFields.some((field) => field.includes(term)))) return -1;

  let relevance = 0;
  if (title === normalizedQuery) relevance += 10_000;
  else if (title.startsWith(normalizedQuery)) relevance += 7_500;
  else if (title.includes(normalizedQuery)) relevance += 5_000;
  if (userMessages.some((message) => message.includes(normalizedQuery))) relevance += 1_000;

  for (const term of terms) {
    if (title === term) relevance += 1_000;
    else if (title.startsWith(term)) relevance += 750;
    else if (title.includes(term)) relevance += 500;
    if (userMessages.some((message) => message.includes(term))) relevance += 100;
  }
  return relevance;
}

export function sessionMatchesQuery(
  session: Pick<ChatSession, "title" | "messages">,
  query: string,
) {
  return sessionSearchRelevance(session, query) >= 0;
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

export function resolveSessionTitle(currentTitle: string | undefined, messages: UIMessage[]) {
  const derived = deriveTitle(messages);
  const current = currentTitle?.trim();
  if (!current || current === "新对话" || current === derived) return derived;
  return current;
}
