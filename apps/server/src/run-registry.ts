import { randomUUID } from "node:crypto";
import { createOpenAI, openai } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type ToolSet,
  type UIMessage,
} from "ai";
import { createBusinessTools } from "./business-tools.ts";
import type { ChatConfigStore } from "./chat-config.ts";
import { createClientTools } from "./client-tools.ts";
import type { EventHub } from "./events.ts";
import { createKimiFetch } from "./kimi.ts";
import { createMiniMaxFetch, isMiniMaxModel } from "./minimax.ts";
import {
  type ChatSession,
  deriveTitle,
  type RunStartInput,
  type SandboxMode,
  type SessionStatus,
} from "./protocol.ts";
import { RunJournal } from "./run-journal.ts";
import {
  classifySandboxBoundary,
  reviewSandboxBoundary,
  type SandboxBoundaryAssessment,
} from "./sandbox-boundary-reviewer.ts";
import { SandboxReviewLogStore } from "./sandbox-review-log.ts";
import type { SessionStore } from "./store.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { hasWorkspace, selectWorkspaceToolNames } from "./tool-selection.ts";
import {
  createWorkspaceTools,
  preflightWorkspaceTool,
  type WorkspaceToolPreflightMap,
} from "./workspace-tools.ts";

type ActiveRun = {
  id: string;
  sessionId: string;
  controller: AbortController;
};

export const MAX_AGENT_STEPS = 30;

export function reachedToolLimit(stepCount: number, finishReason: string | undefined) {
  return stepCount >= MAX_AGENT_STEPS && finishReason === "tool-calls";
}

export function resolveEffectiveWorkspace(
  current: ChatSession,
  input: RunStartInput,
  resolveWorkspace: (id: string) => string | undefined,
) {
  const resolvedWorkspace = input.workspaceId ? resolveWorkspace(input.workspaceId) : undefined;
  if (input.workspaceId && !resolvedWorkspace) throw new Error("workspace 不存在");
  if (input.cwd && !input.workspaceId) throw new Error("请先选择已注册的 workspace");
  return resolvedWorkspace ?? current.cwd;
}

function baseUrl(value: string) {
  return value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/responses$/i, "");
}

function assistantMessage(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: text ? [{ type: "text", text }] : [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isMissingMessageId(id: string | undefined) {
  return !id?.trim() || id.startsWith("legacy-message-");
}

export function normalizeCompletedMessages(messages: UIMessage[], runId: string) {
  let lastAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex < 0) return messages;
  return messages.map((message, index) =>
    index === lastAssistantIndex && isMissingMessageId(message.id)
      ? { ...message, id: runId }
      : message,
  );
}

export function mergeLatestMessageMetadata(messages: UIMessage[], metadata: unknown) {
  if (metadata === undefined) return messages;
  let lastAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex < 0) return messages;
  const message = messages[lastAssistantIndex];
  const mergedMetadata =
    isRecord(message.metadata) && isRecord(metadata)
      ? { ...message.metadata, ...metadata }
      : metadata;
  return messages.map((item, index) =>
    index === lastAssistantIndex ? { ...item, metadata: mergedMetadata } : item,
  );
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export class RunRegistry {
  private readonly active = new Map<string, ActiveRun>();
  private readonly statuses = new Map<string, SessionStatus>();
  private readonly drafts = new Map<string, UIMessage>();
  private readonly store: SessionStore;
  private readonly events: EventHub;
  private readonly chatConfig: ChatConfigStore;
  private readonly journal: RunJournal;
  private readonly reviewLog: SandboxReviewLogStore;
  private readonly toolApprovalSecret = randomUUID();
  private readonly resolveWorkspace: (id: string) => string | undefined;

  constructor(
    store: SessionStore,
    events: EventHub,
    chatConfig: ChatConfigStore,
    resolveWorkspace: (id: string) => string | undefined = () => undefined,
  ) {
    this.store = store;
    this.events = events;
    this.chatConfig = chatConfig;
    this.resolveWorkspace = resolveWorkspace;
    this.journal = new RunJournal(store.root);
    this.reviewLog = new SandboxReviewLogStore(store.root);
  }

  async initialize() {
    await this.reviewLog.init();
    const interrupted = await this.journal.recover();
    for (const entry of interrupted) {
      this.statuses.set(entry.sessionId, "error");
      await this.journal.clear(entry.runId);
    }
  }

  async shutdown() {
    const runs = [...this.active.values()];
    for (const run of runs) run.controller.abort();
    await Promise.all(runs.map((run) => this.journal.clear(run.id)));
    this.drafts.clear();
  }

  statusMap() {
    return this.statuses;
  }

  activeCount() {
    return this.active.size;
  }

  reviewLogs(sessionId?: string) {
    const entries = this.reviewLog.list();
    return sessionId ? entries.filter((entry) => entry.sessionId === sessionId) : entries;
  }

  draftMessage(sessionId: string) {
    return this.drafts.get(sessionId);
  }

  private setStatus(sessionId: string, status: SessionStatus, runId?: string) {
    this.statuses.set(sessionId, status);
    this.events.publish({ type: "session.status", sessionId, runId, status });
  }

  async start(sessionId: string, input: RunStartInput) {
    if (this.active.has(sessionId)) throw new Error("该会话已有正在运行的任务");
    const chatConfig = this.chatConfig.get();
    const model = resolveConfiguredModel(chatConfig, input);
    if (!model?.apiKey || !model.baseUrl || !model.name) {
      throw new Error("模型配置不完整");
    }

    const current = await this.store.get(sessionId);
    if (!current) throw new Error("会话不存在");
    const sandboxMode = input.sandboxMode ?? chatConfig.sandboxMode ?? "ask";
    const approvedEscalationToolCallIds = collectApprovedToolCallIds(input.messages ?? []);
    const preflightResults: WorkspaceToolPreflightMap = new Map();
    const reviewerModel = resolveApprovalReviewerModel(chatConfig);
    const messages = input.messages?.length
      ? input.messages
      : input.message
        ? [...current.messages, input.message]
        : current.messages;
    const now = new Date().toISOString();
    const effectiveCwd = resolveEffectiveWorkspace(current, input, this.resolveWorkspace);
    const workspaceToolInstructions = effectiveCwd
      ? "本地源码检索规则：按文件名或关键词查找时必须使用 search_files，它支持 query 关键词并遵循 workspace 的 Git 排除规则；不要通过 bash 执行递归 grep、find 或 rg，尤其不要扫描 node_modules、.git、dist、target。"
      : "";
    const prompt = await buildSystemPrompt({
      cwd: effectiveCwd,
      system: input.system,
      memory: input.memory,
      workspaceToolInstructions,
    });
    const session: ChatSession = {
      ...current,
      title: input.title?.trim() || deriveTitle(messages),
      updatedAt: now,
      modelId: model.id || model.name,
      workspaceId: input.workspaceId ?? current.workspaceId,
      cwd: effectiveCwd,
      sandboxMode,
      mcpServerIds: input.mcpServerIds ?? current.mcpServerIds,
      skillIds: input.skillIds ?? current.skillIds,
      systemPrompt: prompt,
      messages,
    };
    await this.store.save(session);

    const runId = randomUUID();
    await this.journal.begin({ sessionId, runId, startedAt: now });
    const controller = new AbortController();
    this.active.set(sessionId, { id: runId, sessionId, controller });
    this.drafts.set(sessionId, assistantMessage(runId, ""));
    this.setStatus(sessionId, "submitted", runId);

    try {
      const provider = createOpenAI({
        apiKey: model.apiKey,
        baseURL: baseUrl(model.baseUrl),
        fetch: isMiniMaxModel(model) ? createMiniMaxFetch(model) : createKimiFetch(model),
      });
      const languageModel = model.responsive
        ? provider.responses(model.name.trim())
        : provider.chat(model.name.trim());
      const modelMessages = await convertToModelMessages(messages);
      const system = prompt.text;
      let completedStepCount = 0;
      const result = streamText({
        model: languageModel,
        messages: modelMessages,
        ...(system ? (model.responsive ? { instructions: system } : { system }) : {}),
        tools: model.supportsTools
          ? {
              ...(createClientTools(input.toolNames) ?? {}),
              ...createWorkspaceToolsForInput({
                ...input,
                sandboxReadablePaths: chatConfig.sandboxReadablePaths,
                developerToolPaths: chatConfig.developerToolPaths,
                cwd: effectiveCwd,
                model,
                sandboxMode,
                approvedEscalationToolCallIds,
                preflightResults,
                onSandboxBlocked: createSandboxEscalationHandler({
                  mode: sandboxMode,
                  workspace: session.cwd,
                  messages,
                  reviewerModel,
                  approvedEscalationToolCallIds,
                  reviewLog: this.reviewLog,
                  sessionId,
                  runId,
                }),
              }),
              ...selectTools(createBusinessTools(chatConfig.apiKeys), input.toolNames),
              ...(input.toolNames?.includes("web_search") && model.responsive
                ? { web_search: openai.tools.webSearch({}) as unknown as ToolSet[string] }
                : {}),
            }
          : undefined,
        toolApproval: createToolApproval({
          mode: sandboxMode,
          workspace: session.cwd,
          messages,
          reviewerModel,
          approvedEscalationToolCallIds,
          reviewLog: this.reviewLog,
          sessionId,
          runId,
          readablePaths: chatConfig.sandboxReadablePaths,
          developerToolPaths: chatConfig.developerToolPaths,
          preflightResults,
        }),
        experimental_toolApprovalSecret: this.toolApprovalSecret,
        stopWhen: stepCountIs(MAX_AGENT_STEPS),
        onStepEnd: () => {
          completedStepCount += 1;
        },
        abortSignal: controller.signal,
      });
      let completedMessages: UIMessage[] | undefined;
      const uiStream = result.toUIMessageStream({
        originalMessages: messages,
        messageMetadata: ({ part }) => {
          if (part.type !== "finish") return undefined;
          const toolLimitReached = reachedToolLimit(completedStepCount, part.finishReason);
          return {
            usage: part.totalUsage,
            ...(toolLimitReached ? { toolLimitReached: true, stopReason: "tool-limit" } : {}),
          };
        },
        onFinish: ({ messages: finishedMessages }) => {
          completedMessages = finishedMessages;
        },
        onError: errorMessage,
      });
      const [clientStream, observerStream] = uiStream.tee();
      void this.consume(session, runId, observerStream, () => completedMessages);
      return createUIMessageStreamResponse({ stream: clientStream });
    } catch (error) {
      this.active.delete(sessionId);
      this.drafts.delete(sessionId);
      await this.journal.clear(runId);
      this.setStatus(sessionId, "error", runId);
      throw error;
    }
  }

  stop(sessionId: string) {
    const run = this.active.get(sessionId);
    if (!run) return false;
    run.controller.abort();
    return true;
  }

  private async consume(
    session: ChatSession,
    runId: string,
    stream: ReadableStream<unknown>,
    getCompletedMessages: () => UIMessage[] | undefined,
  ) {
    const sessionId = session.id;
    let assistantText = "";
    let latestMessageMetadata: unknown;
    this.setStatus(sessionId, "streaming", runId);
    try {
      const reader = stream.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value as { type?: string; delta?: string; messageMetadata?: unknown };
        if (chunk.messageMetadata !== undefined) {
          latestMessageMetadata = chunk.messageMetadata;
        }
        if (chunk.type === "text-delta" && typeof chunk.delta === "string") {
          assistantText += chunk.delta;
          this.drafts.set(sessionId, assistantMessage(runId, assistantText));
          this.events.publish({
            type: "message.delta",
            sessionId,
            runId,
            messageId: runId,
            delta: chunk.delta,
          });
        }
      }
      const completedMessages = getCompletedMessages();
      const persistedMessages = completedMessages
        ? normalizeCompletedMessages(completedMessages, runId)
        : assistantText
          ? [...session.messages, assistantMessage(runId, assistantText)]
          : session.messages;
      const nextMessages = mergeLatestMessageMetadata(persistedMessages, latestMessageMetadata);
      const updated: ChatSession = {
        ...session,
        messages: nextMessages,
        updatedAt: new Date().toISOString(),
        title: deriveTitle(nextMessages),
      };
      await this.store.save(updated);
      this.drafts.delete(sessionId);
      this.events.publish({
        type: "message.updated",
        sessionId,
        runId,
        messageId: runId,
        message: nextMessages[nextMessages.length - 1],
      });
      this.setStatus(sessionId, "ready", runId);
      this.events.publish({ type: "run.done", sessionId, runId });
    } catch (error) {
      const message = errorMessage(error);
      this.setStatus(sessionId, "error", runId);
      this.events.publish({ type: "run.error", sessionId, runId, error: message });
    } finally {
      this.active.delete(sessionId);
      await this.journal.clear(runId).catch((error) => {
        console.error("Failed to clear Chat Server run journal", error);
      });
    }
  }
}

function createToolApproval(options: {
  mode: SandboxMode;
  workspace: string | undefined;
  messages: UIMessage[];
  reviewerModel: import("./protocol.ts").ServerModelConfig | undefined;
  approvedEscalationToolCallIds: Set<string>;
  reviewLog: SandboxReviewLogStore;
  sessionId: string;
  runId: string;
  readablePaths: string[];
  developerToolPaths: string[];
  preflightResults: WorkspaceToolPreflightMap;
}) {
  const mode = options.mode;
  if (mode === "full") return undefined;
  return async ({
    toolCall,
  }: {
    toolCall: { toolCallId?: string; toolName?: string; input?: unknown } | undefined;
  }) => {
    const toolName = toolCall?.toolName;
    if (!toolName || !isWorkspaceTool(toolName)) return "not-applicable" as const;

    const toolCallId = toolCall.toolCallId;
    if (toolCallId && options.approvedEscalationToolCallIds.has(toolCallId)) {
      return "approved" as const;
    }

    const assessment = classifySandboxBoundary(toolCall, options.workspace, options.readablePaths);
    const preflightable = ["list_dir", "search_files", "read_file", "bash"].includes(toolName);
    if (
      preflightable &&
      options.workspace &&
      toolCallId &&
      !options.approvedEscalationToolCallIds.has(toolCallId)
    ) {
      const preflight = await preflightWorkspaceTool({
        toolName,
        input: toolCall.input,
        cwd: options.workspace,
        mode,
        readablePaths: options.readablePaths,
        developerToolPaths: options.developerToolPaths,
      });
      options.preflightResults.set(toolCallId, preflight);
      if (preflight.status === "ok" || preflight.status === "error")
        return "not-applicable" as const;
      if (mode === "ask") {
        await logSandboxReview(options.reviewLog, {
          sessionId: options.sessionId,
          runId: options.runId,
          toolCall,
          assessment: {
            ...assessment,
            requiresReview: true,
            reasons: ["sandbox-denied"],
            summary: "实际执行时被当前沙箱拦截",
          },
          decision: "user-approval",
          reason: "sandbox-blocked",
          error: preflight.error.message,
        });
        return "user-approval";
      }
    }
    if (!assessment.requiresReview) {
      if (options.mode === "auto") return "not-applicable" as const;
      if (!isWorkspaceMutationTool(toolName)) return "not-applicable" as const;
      return "user-approval";
    }

    if (mode === "auto") return "not-applicable" as const;

    if (mode === "ask") {
      await logSandboxReview(options.reviewLog, {
        sessionId: options.sessionId,
        runId: options.runId,
        toolCall,
        assessment,
        decision: "user-approval",
        reason: "sandbox-mode-ask",
      });
      return "user-approval";
    }
    if (!toolCallId || !options.workspace || !options.reviewerModel) {
      await logSandboxReview(options.reviewLog, {
        sessionId: options.sessionId,
        runId: options.runId,
        toolCall,
        assessment,
        decision: "user-approval",
        reason: !options.reviewerModel ? "reviewer-not-configured" : "missing-tool-call-context",
      });
      return "user-approval";
    }

    try {
      const result = await reviewSandboxBoundary({
        model: options.reviewerModel,
        toolCall,
        assessment,
        workspace: options.workspace,
        sandboxMode: mode,
        messages: options.messages,
      });
      await logSandboxReview(options.reviewLog, {
        sessionId: options.sessionId,
        runId: options.runId,
        toolCall,
        assessment,
        ...result,
      });
      if (result.decision === "approve") {
        options.approvedEscalationToolCallIds.add(toolCallId);
        return { type: "approved" as const, reason: result.rationale };
      }
      return { type: "denied" as const, reason: result.rationale };
    } catch (error) {
      await logSandboxReview(options.reviewLog, {
        sessionId: options.sessionId,
        runId: options.runId,
        toolCall,
        assessment,
        decision: "user-approval",
        reason: "reviewer-failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return "user-approval";
    }
  };
}

function createSandboxEscalationHandler(options: {
  mode: SandboxMode;
  workspace: string | undefined;
  messages: UIMessage[];
  reviewerModel: import("./protocol.ts").ServerModelConfig | undefined;
  approvedEscalationToolCallIds: Set<string>;
  reviewLog: SandboxReviewLogStore;
  sessionId: string;
  runId: string;
}) {
  return async (toolCall: {
    toolName: string;
    toolCallId?: string;
    input: unknown;
    errorReason?: string;
  }) => {
    const assessment: SandboxBoundaryAssessment = {
      requiresReview: true,
      reasons: ["sandbox-denied"],
      summary: "实际执行时被当前沙箱拦截",
    };
    if (
      options.mode !== "auto" ||
      !toolCall.toolCallId ||
      !options.workspace ||
      !options.reviewerModel
    ) {
      await logSandboxReview(options.reviewLog, {
        sessionId: options.sessionId,
        runId: options.runId,
        toolCall,
        assessment,
        decision: "user-approval",
        reason: !options.reviewerModel ? "reviewer-not-configured" : "sandbox-blocked",
        error: toolCall.errorReason,
      });
      return {
        approved: false,
        reason: `沙箱拒绝：${toolCall.errorReason ?? "未提供具体原因"}`,
      };
    }

    try {
      const result = await reviewSandboxBoundary({
        model: options.reviewerModel,
        toolCall,
        assessment,
        workspace: options.workspace,
        sandboxMode: options.mode,
        messages: options.messages,
      });
      await logSandboxReview(options.reviewLog, {
        sessionId: options.sessionId,
        runId: options.runId,
        toolCall,
        assessment,
        ...result,
      });
      if (result.decision !== "approve") return { approved: false, reason: result.rationale };
      options.approvedEscalationToolCallIds.add(toolCall.toolCallId);
      return { approved: true, reason: result.rationale };
    } catch (error) {
      await logSandboxReview(options.reviewLog, {
        sessionId: options.sessionId,
        runId: options.runId,
        toolCall,
        assessment,
        decision: "user-approval",
        reason: "reviewer-failed",
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        approved: false,
        reason: `Reviewer 调用失败，沙箱拒绝：${error instanceof Error ? error.message : String(error)}`,
      };
    }
  };
}

function isWorkspaceMutationTool(toolName: string) {
  return toolName === "write_file" || toolName === "edit_file" || toolName === "bash";
}

function isWorkspaceTool(toolName: string) {
  return (
    toolName === "list_dir" ||
    toolName === "search_files" ||
    toolName === "read_file" ||
    isWorkspaceMutationTool(toolName)
  );
}

function collectApprovedToolCallIds(messages: UIMessage[]) {
  const approved = new Set<string>();
  for (const message of messages) {
    for (const part of message.parts) {
      if (!part || typeof part !== "object") continue;
      const value = part as {
        toolCallId?: unknown;
        state?: unknown;
        approval?: { approved?: unknown };
      };
      if (
        typeof value.toolCallId === "string" &&
        value.state === "approval-responded" &&
        value.approval?.approved === true
      ) {
        approved.add(value.toolCallId);
      }
    }
  }
  return approved;
}

function resolveConfiguredModel(
  config: { models: unknown[]; apiKeys: Record<string, string> },
  input: RunStartInput,
) {
  const candidate =
    input.model ??
    config.models.find((item) => {
      if (!item || typeof item !== "object") return false;
      const value = item as { id?: unknown; name?: unknown };
      return value.id === input.modelId || value.name === input.modelId;
    });
  if (!candidate || typeof candidate !== "object") return undefined;
  const value = candidate as import("./protocol.ts").ServerModelConfig;
  return { ...value, apiKey: value.apiKey || config.apiKeys[value.id ?? value.name] };
}

function resolveApprovalReviewerModel(config: {
  models: unknown[];
  apiKeys: Record<string, string>;
  approvalReviewerModelId?: string;
}) {
  if (!config.approvalReviewerModelId) return undefined;
  return resolveConfiguredModel(config, { modelId: config.approvalReviewerModelId });
}

function createWorkspaceToolsForInput(
  input: RunStartInput & {
    approvedEscalationToolCallIds: Set<string>;
    onSandboxBlocked: Parameters<typeof createWorkspaceTools>[3];
    sandboxReadablePaths?: string[];
    developerToolPaths?: string[];
    preflightResults: WorkspaceToolPreflightMap;
  },
) {
  const cwd = input.cwd?.trim();
  if (!hasWorkspace(cwd)) return {};
  const names = new Set(input.toolNames ?? []);
  if (
    !["list_dir", "search_files", "read_file", "write_file", "edit_file", "terminal", "bash"].some(
      (name) => names.has(name),
    )
  )
    return {};
  const tools = createWorkspaceTools(
    cwd,
    input.sandboxMode ?? "ask",
    input.approvedEscalationToolCallIds,
    input.onSandboxBlocked,
    input.sandboxReadablePaths,
    input.preflightResults,
    input.developerToolPaths,
  );
  const selected = selectWorkspaceToolNames(names);
  return Object.fromEntries(selected.map((name) => [name, tools[name]]));
}

async function logSandboxReview(
  reviewLog: SandboxReviewLogStore,
  payload: {
    sessionId?: string;
    runId?: string;
    toolCall?: { toolCallId?: string; toolName?: string; input?: unknown };
    assessment: SandboxBoundaryAssessment;
    decision: string;
    rationale?: string;
    reason?: string;
    modelId?: string;
    durationMs?: number;
    error?: string;
  },
) {
  try {
    await reviewLog.append({
      sessionId: payload.sessionId,
      runId: payload.runId,
      toolCallId: payload.toolCall?.toolCallId,
      toolName: payload.toolCall?.toolName,
      command: extractBashCommand(payload.toolCall),
      input: extractReviewInput(payload.toolCall),
      reasons: payload.assessment.reasons,
      decision: payload.decision as "approve" | "deny" | "user-approval",
      rationale: payload.rationale,
      reason: payload.reason,
      modelId: payload.modelId,
      durationMs: payload.durationMs,
      error: payload.error?.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500),
    });
  } catch (error) {
    console.error("Failed to persist sandbox review log", error);
  }
  console.info(
    "[Sandbox reviewer]",
    JSON.stringify({
      sessionId: payload.sessionId,
      runId: payload.runId,
      toolCallId: payload.toolCall?.toolCallId,
      toolName: payload.toolCall?.toolName,
      command: extractBashCommand(payload.toolCall),
      input: extractReviewInput(payload.toolCall),
      reasons: payload.assessment.reasons,
      decision: payload.decision,
      rationale: payload.rationale,
      reason: payload.reason,
      modelId: payload.modelId,
      durationMs: payload.durationMs,
      error: payload.error?.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 500),
    }),
  );
}

function extractBashCommand(toolCall: { toolName?: string; input?: unknown } | undefined) {
  if (toolCall?.toolName !== "bash" || !toolCall.input || typeof toolCall.input !== "object") {
    return undefined;
  }
  const command = (toolCall.input as { command?: unknown }).command;
  return typeof command === "string" && command.trim()
    ? command.replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 12_000)
    : undefined;
}

function extractReviewInput(
  toolCall: { toolName?: string; input?: unknown } | undefined,
): Record<string, unknown> | undefined {
  if (!toolCall?.input || typeof toolCall.input !== "object") return undefined;
  const input = toolCall.input as Record<string, unknown>;
  const fieldsByTool: Record<string, string[]> = {
    list_dir: ["path"],
    read_file: ["path"],
    search_files: ["path", "pattern", "query", "maxResults"],
    write_file: ["path"],
    edit_file: ["path"],
    bash: ["cwd"],
  };
  const fields = fieldsByTool[toolCall.toolName ?? ""];
  if (!fields) return undefined;
  const result = Object.fromEntries(
    fields
      .filter((field) => input[field] !== undefined)
      .map((field) => [
        field,
        typeof input[field] === "string"
          ? input[field].replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 2_000)
          : input[field],
      ]),
  );
  return Object.keys(result).length > 0 ? result : undefined;
}

function selectTools(tools: Record<string, unknown>, names: string[] | undefined) {
  const selected = new Set(names ?? []);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => selected.has(name)));
}
