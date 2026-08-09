import { randomUUID } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type ToolSet,
  type UIMessage,
} from "ai";
import { createClientTools } from "./client-tools.ts";
import type { EventHub } from "./events.ts";
import {
  deriveTitle,
  type ChatSession,
  type RunStartInput,
  type SandboxMode,
  type SessionStatus,
} from "./protocol.ts";
import { SessionStore } from "./store.ts";
import { createWorkspaceTools } from "./workspace-tools.ts";
import type { ChatConfigStore } from "./chat-config.ts";
import { createBusinessTools } from "./business-tools.ts";
import { openai } from "@ai-sdk/openai";
import { RunJournal } from "./run-journal.ts";
import {
  classifySandboxBoundary,
  reviewSandboxBoundary,
  type SandboxBoundaryAssessment,
} from "./sandbox-boundary-reviewer.ts";

type ActiveRun = {
  id: string;
  sessionId: string;
  controller: AbortController;
};

function baseUrl(value: string) {
  return value.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/responses$/i, "");
}

function assistantMessage(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: text ? [{ type: "text", text }] : [] };
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
  private readonly toolApprovalSecret = randomUUID();

  constructor(store: SessionStore, events: EventHub, chatConfig: ChatConfigStore) {
    this.store = store;
    this.events = events;
    this.chatConfig = chatConfig;
    this.journal = new RunJournal(store.root);
  }

  async initialize() {
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
    const reviewerModel = resolveApprovalReviewerModel(chatConfig);
    const messages = input.messages?.length
      ? input.messages
      : input.message
        ? [...current.messages, input.message]
        : current.messages;
    const now = new Date().toISOString();
    const session: ChatSession = {
      ...current,
      title: input.title?.trim() || deriveTitle(messages),
      updatedAt: now,
      modelId: model.id || model.name,
      workspaceId: input.workspaceId ?? current.workspaceId,
      cwd: input.cwd ?? current.cwd,
      sandboxMode,
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
      const provider = createOpenAI({ apiKey: model.apiKey, baseURL: baseUrl(model.baseUrl) });
      const languageModel = model.responsive
        ? provider.responses(model.name.trim())
        : provider.chat(model.name.trim());
      const modelMessages = await convertToModelMessages(messages);
      const system = [input.system, input.memory, input.cwd ? `当前 workspace：${input.cwd}` : ""]
        .filter(Boolean)
        .join("\n\n");
      const result = streamText({
        model: languageModel,
        messages: modelMessages,
        ...(system ? (model.responsive ? { instructions: system } : { system }) : {}),
        tools: model.supportsTools
          ? {
              ...(createClientTools(input.toolNames) ?? {}),
              ...createWorkspaceToolsForInput({
                ...input,
                model,
                sandboxMode,
                approvedEscalationToolCallIds,
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
        }),
        experimental_toolApprovalSecret: this.toolApprovalSecret,
        stopWhen: stepCountIs(20),
        abortSignal: controller.signal,
      });
      let completedMessages: UIMessage[] | undefined;
      const uiStream = result.toUIMessageStream({
        originalMessages: messages,
        messageMetadata: ({ part }) => {
          if (part.type !== "finish") return undefined;
          return { usage: part.totalUsage };
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
    this.setStatus(sessionId, "streaming", runId);
    try {
      const reader = stream.getReader();
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        const chunk = next.value as { type?: string; delta?: string; messageMetadata?: unknown };
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
      const nextMessages = getCompletedMessages() ??
        (assistantText ? [...session.messages, assistantMessage(runId, assistantText)] : session.messages);
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

    const assessment = classifySandboxBoundary(toolCall, options.workspace);
    if (!assessment.requiresReview) {
      if (!isWorkspaceMutationTool(toolName)) return "not-applicable" as const;
      return options.mode === "auto" ? "not-applicable" : "user-approval";
    }

    if (mode === "ask") return "user-approval";
    if (!toolCallId || !options.workspace || !options.reviewerModel) {
      logSandboxReview({
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
      logSandboxReview({ toolCall, assessment, ...result });
      if (result.decision === "approve") {
        options.approvedEscalationToolCallIds.add(toolCallId);
        return { type: "approved" as const, reason: result.rationale };
      }
      return { type: "denied" as const, reason: result.rationale };
    } catch (error) {
      logSandboxReview({
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
  const candidate = input.model ?? config.models.find((item) => {
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
  input: RunStartInput & { approvedEscalationToolCallIds: Set<string> },
) {
  if (!input.cwd) return {};
  const names = new Set(input.toolNames ?? []);
  if (!["list_dir", "search_files", "read_file", "write_file", "edit_file", "terminal", "bash"].some((name) => names.has(name))) return {};
  const tools = createWorkspaceTools(
    input.cwd,
    input.sandboxMode ?? "ask",
    input.approvedEscalationToolCallIds,
  );
  const selected = names.has("terminal") ? ["bash"] : ["list_dir", "search_files", "read_file", "write_file", "edit_file", "bash"];
  return Object.fromEntries(selected.filter((name) => names.has(name) || (name === "bash" && names.has("terminal"))).map((name) => [name, tools[name]]));
}

function logSandboxReview(payload: {
  toolCall?: { toolCallId?: string; toolName?: string };
  assessment: SandboxBoundaryAssessment;
  decision: string;
  rationale?: string;
  reason?: string;
  modelId?: string;
  durationMs?: number;
  error?: string;
}) {
  console.info(
    "[Sandbox reviewer]",
    JSON.stringify({
      toolCallId: payload.toolCall?.toolCallId,
      toolName: payload.toolCall?.toolName,
      reasons: payload.assessment.reasons,
      decision: payload.decision,
      rationale: payload.rationale,
      reason: payload.reason,
      modelId: payload.modelId,
      durationMs: payload.durationMs,
      error: payload.error
        ?.replace(/Bearer\s+\S+/gi, "Bearer [redacted]")
        .slice(0, 500),
    }),
  );
}

function selectTools(tools: Record<string, unknown>, names: string[] | undefined) {
  const selected = new Set(names ?? []);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => selected.has(name)));
}
