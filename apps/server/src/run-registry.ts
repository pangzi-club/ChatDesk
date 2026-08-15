import { randomUUID } from "node:crypto";
import { createOpenAI, openai } from "@ai-sdk/openai";
import { MAX_AGENT_STEPS } from "@chatdesk/shared";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  generateText,
  isToolUIPart,
  type LanguageModel,
  readUIMessageStream,
  stepCountIs,
  streamText,
  type ToolSet,
  type UIMessage,
  type UIMessageChunk,
} from "ai";
import type { ActivityLogStore } from "./activity-log-store.ts";
import {
  buildCheckpointPrompt,
  CHECKPOINT_OUTPUT_TOKENS,
  checkpointInstructions,
  estimateAgentContextTokens,
  retainRecentModelMessages,
} from "./agent-context.ts";
import { type AiUsageLogStore, normalizeAiUsage } from "./ai-usage-log.ts";
import { createBusinessTools } from "./business-tools.ts";
import type { ChatConfigStore } from "./chat-config.ts";
import { createClientTools } from "./client-tools.ts";
import type { EventHub } from "./events.ts";
import { createKimiFetch } from "./kimi.ts";
import { createMiniMaxFetch, isMiniMaxModel } from "./minimax.ts";
import type { PlanStore } from "./plan-store.ts";
import { createPlanWriteTool } from "./plan-tool.ts";
import {
  type ChatContextCompaction,
  type ChatContextUsage,
  type ChatPlanMode,
  type ChatRunProgress,
  type ChatRunStopReason,
  type ChatRunSummary,
  type ChatSession,
  type ChatTokenUsage,
  deriveTitle,
  type RunStartInput,
  resolveContextCompactionThreshold,
  type SandboxMode,
  type SessionStatus,
} from "./protocol.ts";
import { RunJournal } from "./run-journal.ts";
import {
  decideRunStep,
  evaluateRunCompletion,
  PLAN_MAX_STEPS,
  ReadOnlyToolLoopTracker,
  ReadOnlyToolResultDeduplicator,
} from "./run-policy.ts";
import {
  classifySandboxBoundary,
  reviewSandboxBoundary,
  type SandboxBoundaryAssessment,
} from "./sandbox-boundary-reviewer.ts";
import { SandboxReviewLogStore } from "./sandbox-review-log.ts";
import type { SessionStore } from "./store.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { createTodoTool, TODO_TOOL_INSTRUCTIONS } from "./todo-tool.ts";
import {
  hasWorkspace,
  selectPlanWorkspaceToolNames,
  selectWorkspaceToolNames,
  workspaceSearchInstructions,
} from "./tool-selection.ts";
import {
  createWorkspaceTools,
  preflightWorkspaceTool,
  type WorkspaceToolPreflightMap,
} from "./workspace-tools.ts";

type ActiveRun = {
  id: string;
  sessionId: string;
  controller: AbortController;
  done?: Promise<void>;
};

type TerminalRunState = {
  observed: boolean;
  text: string;
  finishReason?: string;
};

type RunMetrics = {
  stepCount: number;
  modelCallCount: number;
  toolCallCount: number;
  duplicateToolCallCount: number;
  compactionCount: number;
  planWritten: boolean;
  usage?: ChatTokenUsage;
  forcedStopReason?: ChatRunStopReason;
  failureMessage?: string;
};

class RunFailure extends Error {
  readonly stopReason: ChatRunStopReason;

  constructor(stopReason: ChatRunStopReason, message: string) {
    super(message);
    this.name = "RunFailure";
    this.stopReason = stopReason;
  }
}

export { MAX_AGENT_STEPS };
export const MODEL_CALL_MAX_RETRIES = 0;

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

function createConfiguredLanguageModel(model: import("./protocol.ts").ServerModelConfig) {
  const provider = createOpenAI({
    apiKey: model.apiKey,
    baseURL: baseUrl(model.baseUrl),
    fetch: isMiniMaxModel(model) ? createMiniMaxFetch(model) : createKimiFetch(model),
  });
  return model.responsive
    ? provider.responses(model.name.trim())
    : provider.chat(model.name.trim());
}

function assistantMessage(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: text ? [{ type: "text", text }] : [] };
}

function messageText(message: UIMessage) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function normalizeRunMessage(message: UIMessage, runId: string): UIMessage {
  return { ...message, id: message.id.trim() || runId, role: "assistant" };
}

export function mergeRunMessage(messages: UIMessage[], draft: UIMessage) {
  const existingIndex = messages.findIndex((message) => message.id === draft.id);
  if (existingIndex < 0) return [...messages, draft];
  return messages.map((message, index) => (index === existingIndex ? draft : message));
}

export function runCheckpointFingerprint(message: UIMessage) {
  const checkpointParts = message.parts.filter((part) => {
    if (part.type === "step-start") return false;
    if (part.type === "text" || part.type === "reasoning") return part.state !== "streaming";
    if (isToolUIPart(part)) return part.state !== "input-streaming";
    return true;
  });
  return checkpointParts.length > 0 ? JSON.stringify(checkpointParts) : "";
}

const INTERRUPTED_TOOL_STATES = new Set([
  "input-streaming",
  "input-available",
  "approval-requested",
  "approval-responded",
]);

export function interruptRunMessage(message: UIMessage, reason = "运行已中断") {
  return {
    ...message,
    parts: message.parts.map((part): UIMessage["parts"][number] => {
      if (part.type === "text" || part.type === "reasoning") {
        return part.state === "streaming" ? { ...part, state: "done" } : part;
      }
      if (!isToolUIPart(part) || !INTERRUPTED_TOOL_STATES.has(part.state)) return part;
      const rest = { ...part } as Record<string, unknown>;
      delete rest.approval;
      delete rest.output;
      delete rest.preliminary;
      return {
        ...rest,
        state: "output-error",
        input: part.state === "input-streaming" ? undefined : part.input,
        ...(part.state === "input-streaming" && part.input !== undefined
          ? { rawInput: part.input }
          : {}),
        errorText: reason,
      } as UIMessage["parts"][number];
    }),
  };
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

function diagnosticError(error: unknown, depth = 0): unknown {
  if (depth >= 3) return errorMessage(error);
  if (!(error instanceof Error)) return errorMessage(error);
  const value = error as Error & {
    cause?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    syscall?: unknown;
    hostname?: unknown;
    address?: unknown;
  };
  return {
    name: value.name,
    message: value.message,
    ...(value.stack ? { stack: value.stack.slice(0, 8_000) } : {}),
    ...(value.code !== undefined ? { code: value.code } : {}),
    ...(value.status !== undefined ? { status: value.status } : {}),
    ...(value.statusCode !== undefined ? { statusCode: value.statusCode } : {}),
    ...(value.syscall !== undefined ? { syscall: value.syscall } : {}),
    ...(value.hostname !== undefined ? { hostname: value.hostname } : {}),
    ...(value.address !== undefined ? { address: value.address } : {}),
    ...(value.cause !== undefined ? { cause: diagnosticError(value.cause, depth + 1) } : {}),
  };
}

function addUsage(current: ChatTokenUsage | undefined, next: ChatTokenUsage | undefined) {
  if (!next) return current;
  const result: ChatTokenUsage = {};
  for (const key of [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningOutputTokens",
  ] as const) {
    const left = current?.[key];
    const right = next[key];
    if (left !== undefined || right !== undefined) result[key] = (left ?? 0) + (right ?? 0);
  }
  return result;
}

function latestAssistantText(messages: UIMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "assistant") return messageText(messages[index]);
  }
  return "";
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
  private readonly plans: PlanStore;
  private readonly aiUsageLogs: AiUsageLogStore;
  private readonly activityLogs: ActivityLogStore;
  private readonly createLanguageModel?: (
    model: import("./protocol.ts").ServerModelConfig,
  ) => LanguageModel;

  constructor(
    store: SessionStore,
    events: EventHub,
    chatConfig: ChatConfigStore,
    plans: PlanStore,
    aiUsageLogs: AiUsageLogStore,
    activityLogs: ActivityLogStore,
    resolveWorkspace: (id: string) => string | undefined = () => undefined,
    createLanguageModel?: (model: import("./protocol.ts").ServerModelConfig) => LanguageModel,
  ) {
    this.store = store;
    this.events = events;
    this.chatConfig = chatConfig;
    this.resolveWorkspace = resolveWorkspace;
    this.plans = plans;
    this.aiUsageLogs = aiUsageLogs;
    this.activityLogs = activityLogs;
    this.createLanguageModel = createLanguageModel;
    this.journal = new RunJournal(store.root);
    this.reviewLog = new SandboxReviewLogStore(store.root);
  }

  async initialize() {
    await this.reviewLog.init();
    const interrupted = await this.journal.recover();
    for (const entry of interrupted) {
      this.statuses.set(entry.sessionId, "error");
      const session = await this.store.get(entry.sessionId);
      const draft = session?.messages.find(
        (message) => message.id === (entry.messageId ?? entry.runId),
      );
      if (session && draft) {
        const runSummary: ChatRunSummary = {
          runId: entry.runId,
          outcome: "error",
          stopReason: "server-restarted",
          stepCount: 0,
          modelCallCount: 0,
          toolCallCount: 0,
          duplicateToolCallCount: 0,
          compactionCount: 0,
          planWritten: false,
        };
        const interruptedDraft = {
          ...interruptRunMessage(draft, "Chat Server 重启，运行已中断"),
          metadata: {
            ...(isRecord(draft.metadata) ? draft.metadata : {}),
            runSummary,
          },
        };
        const messages = mergeRunMessage(session.messages, interruptedDraft);
        await this.store.save({
          ...session,
          messages,
          updatedAt: new Date().toISOString(),
        });
        await this.logRunOutcome(runSummary).catch((error) => {
          console.error("Failed to persist recovered Chat Server run outcome", error);
        });
      }
      await this.journal.clear(entry.runId);
    }
  }

  async shutdown() {
    const runs = [...this.active.values()];
    for (const run of runs) run.controller.abort();
    await Promise.allSettled(runs.flatMap((run) => (run.done ? [run.done] : [])));
    await Promise.all(
      runs.map(async (run) => {
        if (!run.done) {
          const draft = this.drafts.get(run.sessionId);
          if (draft?.parts.length) {
            await this.persistDraft(
              run.sessionId,
              interruptRunMessage(draft, "Chat Server 已停止，运行已中断"),
            );
          }
        }
        await this.journal.clear(run.id);
      }),
    );
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

  private async persistDraft(sessionId: string, draft: UIMessage) {
    const current = await this.store.get(sessionId);
    if (!current) return;
    const messages = mergeRunMessage(current.messages, draft);
    await this.store.save({
      ...current,
      messages,
      title: deriveTitle(messages),
      updatedAt: new Date().toISOString(),
    });
  }

  private async persistRunCheckpoint(
    sessionId: string,
    runId: string,
    startedAt: string,
    draft: UIMessage,
  ) {
    await this.journal.begin({ sessionId, runId, startedAt, messageId: draft.id });
    await this.persistDraft(sessionId, draft);
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
    const planMode = input.planMode ?? current.planMode ?? "apply";
    const planId = input.planId ?? current.activePlanId;
    if (
      planMode === "plan" &&
      (!planId || !(current.plans ?? []).some((plan) => plan.id === planId))
    ) {
      throw new Error("计划模式缺少有效的 active plan");
    }
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
      ? workspaceSearchInstructions(input.toolNames ?? [])
      : "";
    const activePlan = planId ? await this.plans.read(sessionId, planId).catch(() => null) : null;
    const planInstructions =
      planMode === "plan"
        ? "当前处于计划模式：只能调研和提问，不能修改 workspace 代码。需求明确后必须使用 plan_write 更新完整计划；用户回答问题后再次更新计划。"
        : activePlan
          ? `用户已确认执行以下计划：\n\n${activePlan.content}`
          : "";
    const prompt = await buildSystemPrompt({
      cwd: effectiveCwd,
      system: input.system,
      memory: input.memory,
      workspaceToolInstructions,
      planInstructions,
      todoToolInstructions: TODO_TOOL_INSTRUCTIONS,
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
      planMode,
      activePlanId: planId,
    };
    await this.store.save(session);

    const runId = randomUUID();
    await this.journal.begin({ sessionId, runId, startedAt: now });
    const controller = new AbortController();
    const activeRun: ActiveRun = { id: runId, sessionId, controller };
    this.active.set(sessionId, activeRun);
    this.drafts.set(sessionId, assistantMessage(runId, ""));
    this.setStatus(sessionId, "submitted", runId);

    try {
      const languageModel = this.createLanguageModel
        ? this.createLanguageModel(model)
        : createConfiguredLanguageModel(model);
      const modelMessages = await convertToModelMessages(messages);
      const system = prompt.text;
      const metrics: RunMetrics = {
        stepCount: 0,
        modelCallCount: 0,
        toolCallCount: 0,
        duplicateToolCallCount: 0,
        compactionCount: 0,
        planWritten: false,
      };
      const terminal: TerminalRunState = { observed: false, text: "" };
      const duplicateResults = new ReadOnlyToolResultDeduplicator();
      const loopTracker = new ReadOnlyToolLoopTracker();
      let contextCompaction: ChatContextCompaction | undefined;
      let contextUsage: ChatContextUsage | undefined;
      let checkpoint = "";
      let currentPlanContent = activePlan?.content ?? "";
      const contextCompactionThreshold = resolveContextCompactionThreshold(model.inputContext);
      let invocationIndex = 0;
      let modelAttemptCount = 0;
      const activeModelCalls = new Map<
        string,
        { attempt: number; operation: string; startedAt: number }
      >();
      const logRunDiagnostic = async (
        level: "info" | "success" | "warning" | "error",
        message: string,
        details: Record<string, unknown> = {},
      ) => {
        await this.activityLogs
          .append({
            level,
            source: "Agent Run Diagnostic",
            message,
            details: JSON.stringify({ sessionId, runId, ...details }),
          })
          .catch((error) => console.error("Failed to persist run diagnostic", error));
      };
      const publishProgress = (phase: ChatRunProgress["phase"]) => {
        const currentStep = Math.min(
          metrics.stepCount + 1,
          planMode === "plan" ? PLAN_MAX_STEPS : MAX_AGENT_STEPS,
        );
        const runProgress: ChatRunProgress = {
          runId,
          phase,
          stepCount: currentStep,
          modelCallCount: metrics.modelCallCount,
          toolCallCount: metrics.toolCallCount,
          duplicateToolCallCount: metrics.duplicateToolCallCount,
          compactionCount: metrics.compactionCount,
          planWritten: metrics.planWritten,
          planMode,
          ...(metrics.forcedStopReason ? { stopReason: metrics.forcedStopReason } : {}),
        };
        this.events.publish({ type: "run.progress", sessionId, runId, runProgress });
      };
      const recordModelCall =
        (operation: string) =>
        async (event: {
          callId: string;
          usage: unknown;
          modelId: string;
          responseId: string;
          finishReason?: unknown;
          content?: ReadonlyArray<{ type?: unknown }>;
          performance?: { responseTimeMs?: unknown; timeToFirstOutputMs?: unknown };
        }) => {
          metrics.modelCallCount += 1;
          invocationIndex += 1;
          const usage = normalizeAiUsage(event.usage);
          metrics.usage = addUsage(metrics.usage, usage);
          if (usage) {
            await this.aiUsageLogs.append({
              operation,
              modelId: model.id || model.name,
              provider: model.provider,
              model: model.name,
              sessionId,
              runId,
              callId: event.callId,
              invocationIndex,
              providerModelId: event.modelId,
              responseId: event.responseId,
              usage,
            });
          }
          const attempt = activeModelCalls.get(event.callId);
          activeModelCalls.delete(event.callId);
          await logRunDiagnostic(
            "success",
            `模型调用 ${attempt?.attempt ?? invocationIndex} 结束`,
            {
              operation,
              callId: event.callId,
              responseId: event.responseId,
              providerModelId: event.modelId,
              finishReason: event.finishReason,
              contentTypes: event.content?.map((part) => part.type),
              responseTimeMs:
                event.performance?.responseTimeMs ??
                (attempt ? Date.now() - attempt.startedAt : undefined),
              timeToFirstOutputMs: event.performance?.timeToFirstOutputMs,
              usage,
            },
          );
        };
      const recordModelCallStart =
        (operation: string) =>
        async (event: { callId: string; provider: string; modelId: string }) => {
          modelAttemptCount += 1;
          activeModelCalls.set(event.callId, {
            attempt: modelAttemptCount,
            operation,
            startedAt: Date.now(),
          });
          await logRunDiagnostic("info", `模型调用 ${modelAttemptCount} 开始`, {
            operation,
            callId: event.callId,
            provider: event.provider,
            providerModelId: event.modelId,
            nextStep: metrics.stepCount + 1,
          });
        };
      const workspaceTools = createWorkspaceToolsForInput({
        ...input,
        planMode,
        sandboxReadablePaths: chatConfig.sandboxReadablePaths,
        developerToolPaths: chatConfig.developerToolPaths,
        cwd: effectiveCwd,
        model,
        sandboxMode,
        approvedEscalationToolCallIds,
        preflightResults,
        onReadOnlyToolResult: (toolName, toolInput, output, toolCallId) =>
          duplicateResults.compact(toolName, toolInput, output, toolCallId),
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
      });
      const tools = model.supportsTools
        ? {
            ...(planMode === "plan"
              ? {
                  plan_write: createPlanWriteTool(
                    this.plans,
                    this.events,
                    this.store,
                    sessionId,
                    planId as string,
                  ),
                }
              : { todo_write: createTodoTool() }),
            ...(planMode === "plan" ? {} : (createClientTools(input.toolNames) ?? {})),
            ...workspaceTools,
            ...(planMode === "plan"
              ? {}
              : selectTools(createBusinessTools(chatConfig.apiKeys), input.toolNames)),
            ...(planMode !== "plan" && input.toolNames?.includes("web_search") && model.responsive
              ? { web_search: openai.tools.webSearch({}) as unknown as ToolSet[string] }
              : {}),
          }
        : undefined;
      const result = streamText({
        model: languageModel,
        messages: modelMessages,
        ...(system ? (model.responsive ? { instructions: system } : { system }) : {}),
        tools,
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
        stopWhen: stepCountIs(planMode === "plan" ? PLAN_MAX_STEPS : MAX_AGENT_STEPS),
        prepareStep: async ({ messages: stepMessages, stepNumber }) => {
          if (planMode !== "plan" && stepNumber + 1 >= MAX_AGENT_STEPS) {
            metrics.forcedStopReason = "step-limit";
          }
          const policy = decideRunStep({
            planMode,
            stepNumber,
            planWritten: metrics.planWritten,
            forcedStopReason: metrics.forcedStopReason,
          });
          publishProgress(policy.phase);
          let preparedMessages = stepMessages;
          let preparedInstructions = checkpointInstructions({
            base: system,
            checkpoint,
            planContent: planMode === "plan" ? currentPlanContent : undefined,
            policyInstructions: policy.instructions,
          });
          const estimatedTokensBefore = estimateAgentContextTokens(
            preparedMessages,
            preparedInstructions,
          );
          if (estimatedTokensBefore > contextCompactionThreshold) {
            publishProgress("compacting");
            try {
              if (planMode === "plan" && planId) {
                currentPlanContent = (await this.plans.read(sessionId, planId)).content;
              }
              const checkpointResult = await generateText({
                model: languageModel,
                prompt: buildCheckpointPrompt({
                  messages: preparedMessages,
                  existingCheckpoint: checkpoint,
                  planContent: planMode === "plan" ? currentPlanContent : undefined,
                }),
                maxOutputTokens: CHECKPOINT_OUTPUT_TOKENS,
                maxRetries: MODEL_CALL_MAX_RETRIES,
                abortSignal: controller.signal,
                onLanguageModelCallStart: recordModelCallStart("context-checkpoint"),
                onLanguageModelCallEnd: recordModelCall("context-checkpoint"),
              });
              checkpoint = checkpointResult.text.trim();
              if (!checkpoint) throw new Error("模型返回了空检查点");
              preparedMessages = retainRecentModelMessages(preparedMessages);
              preparedInstructions = checkpointInstructions({
                base: system,
                checkpoint,
                planContent: planMode === "plan" ? currentPlanContent : undefined,
                policyInstructions: policy.instructions,
              });
              const estimatedTokensAfter = estimateAgentContextTokens(
                preparedMessages,
                preparedInstructions,
              );
              if (estimatedTokensAfter >= contextCompactionThreshold) {
                throw new RunFailure("context-limit", "生成检查点后上下文仍超过模型限制");
              }
              metrics.compactionCount += 1;
              contextCompaction = {
                count: metrics.compactionCount,
                stepNumber,
                estimatedTokensBefore,
                estimatedTokensAfter,
              };
              this.events.publish({
                type: "context.compacted",
                sessionId,
                runId,
                contextCompaction,
              });
              contextUsage = {
                inputTokens: estimatedTokensAfter,
                source: "estimate",
                stepNumber,
              };
              this.events.publish({
                type: "context.usage",
                sessionId,
                runId,
                contextUsage,
              });
              publishProgress(policy.phase);
            } catch (error) {
              const failure =
                error instanceof RunFailure
                  ? error
                  : new RunFailure(
                      "checkpoint-failed",
                      `上下文检查点生成失败：${errorMessage(error)}`,
                    );
              metrics.forcedStopReason = failure.stopReason;
              metrics.failureMessage = failure.message;
              throw failure;
            }
          }
          return {
            messages: preparedMessages,
            instructions: preparedInstructions,
            ...(policy.activeTools
              ? { activeTools: policy.activeTools as Array<keyof NonNullable<typeof tools>> }
              : {}),
            ...(policy.toolChoice ? { toolChoice: policy.toolChoice } : {}),
          };
        },
        onLanguageModelCallStart: recordModelCallStart("chat-run"),
        onLanguageModelCallEnd: recordModelCall("chat-run"),
        onToolExecutionStart: async (event) => {
          if (!event) return;
          const { callId, toolCall } = event;
          await logRunDiagnostic("info", `工具 ${toolCall.toolName} 开始`, {
            callId,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            step: metrics.stepCount + 1,
          });
        },
        onToolExecutionEnd: async (event) => {
          if (!event) return;
          const { callId, toolCall, toolExecutionMs, toolOutput } = event;
          const outcome = toolOutput?.type ?? "missing";
          const failed = outcome === "tool-error";
          const toolError = toolOutput && "error" in toolOutput ? toolOutput.error : undefined;
          await logRunDiagnostic(failed ? "error" : "success", `工具 ${toolCall.toolName} 结束`, {
            callId,
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            toolExecutionMs,
            outcome,
            ...(failed ? { error: diagnosticError(toolError) } : {}),
          });
        },
        onError: async ({ error }) => {
          await logRunDiagnostic("error", "模型流式响应错误", {
            step: metrics.stepCount + 1,
            modelAttemptCount,
            completedModelCallCount: metrics.modelCallCount,
            pendingModelCalls: [...activeModelCalls.entries()].map(([callId, value]) => ({
              callId,
              attempt: value.attempt,
              operation: value.operation,
              elapsedMs: Date.now() - value.startedAt,
            })),
            error: diagnosticError(error),
          });
        },
        onStepEnd: ({ stepNumber, usage, toolCalls, toolResults }) => {
          const completedToolResults = toolResults.filter(
            (toolResult): toolResult is NonNullable<typeof toolResult> => toolResult !== undefined,
          );
          metrics.stepCount += 1;
          metrics.toolCallCount += toolCalls.length;
          if (
            completedToolResults.some(
              (toolResult) =>
                toolResult.toolName === "plan_write" &&
                typeof (toolResult.output as { characters?: unknown })?.characters === "number" &&
                (toolResult.output as { characters: number }).characters > 0,
            )
          ) {
            metrics.planWritten = true;
          }
          const loop = loopTracker.recordStep(
            completedToolResults.map((toolResult) => ({
              toolName: toolResult.toolName,
              input: toolResult.input,
              output: toolResult.output,
            })),
          );
          metrics.duplicateToolCallCount = loopTracker.duplicateToolCallCount;
          if (loop.loopDetected) metrics.forcedStopReason = "tool-loop";
          if (usage.inputTokens !== undefined) {
            contextUsage = {
              inputTokens: usage.inputTokens,
              source: "provider",
              stepNumber,
            };
            this.events.publish({
              type: "context.usage",
              sessionId,
              runId,
              contextUsage,
            });
          }
        },
        onEnd: ({ text, finishReason }) => {
          terminal.observed = true;
          terminal.text = text;
          terminal.finishReason = finishReason;
        },
        abortSignal: controller.signal,
        maxRetries: MODEL_CALL_MAX_RETRIES,
      });
      let completedMessages: UIMessage[] | undefined;
      let runAborted = false;
      const uiStream = result.toUIMessageStream({
        originalMessages: messages,
        generateMessageId: () => runId,
        messageMetadata: ({ part }) => {
          if (part.type !== "finish") return undefined;
          return {
            usage: metrics.usage ?? part.totalUsage,
            ...(contextUsage ? { contextUsage } : {}),
            ...(contextCompaction ? { contextCompaction } : {}),
          };
        },
        onFinish: ({ messages: finishedMessages, isAborted }) => {
          completedMessages = finishedMessages;
          runAborted = isAborted;
        },
        onError: errorMessage,
      });
      const [clientStream, observerStream] = uiStream.tee();
      activeRun.done = this.consume(
        session,
        runId,
        now,
        observerStream,
        () => completedMessages,
        () => runAborted,
        planMode,
        metrics,
        terminal,
      );
      void activeRun.done;
      return createUIMessageStreamResponse({ stream: clientStream });
    } catch (error) {
      this.active.delete(sessionId);
      const runSummary: ChatRunSummary = {
        runId,
        outcome: "error",
        stopReason: error instanceof RunFailure ? error.stopReason : "incomplete-response",
        stepCount: 0,
        modelCallCount: 0,
        toolCallCount: 0,
        duplicateToolCallCount: 0,
        compactionCount: 0,
        planWritten: false,
      };
      const failedDraft: UIMessage = {
        ...assistantMessage(runId, `运行启动失败：${errorMessage(error)}`),
        metadata: { runSummary },
      };
      this.drafts.set(sessionId, failedDraft);
      await this.persistDraft(sessionId, failedDraft).catch((persistError) => {
        console.error("Failed to persist Chat Server startup failure", persistError);
      });
      this.drafts.delete(sessionId);
      await this.journal.clear(runId);
      this.setStatus(sessionId, "error", runId);
      await this.logRunOutcome(runSummary).catch((logError) => {
        console.error("Failed to persist Chat Server startup outcome", logError);
      });
      this.events.publish({
        type: "run.error",
        sessionId,
        runId,
        error: errorMessage(error),
        runSummary,
      });
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
    startedAt: string,
    stream: ReadableStream<UIMessageChunk>,
    getCompletedMessages: () => UIMessage[] | undefined,
    getRunAborted: () => boolean,
    planMode: ChatPlanMode,
    metrics: RunMetrics,
    terminal: TerminalRunState,
  ) {
    const sessionId = session.id;
    const lastMessage = session.messages[session.messages.length - 1];
    const resumedAssistant = lastMessage?.role === "assistant" ? lastMessage : undefined;
    let latestDraft = resumedAssistant ?? assistantMessage(runId, "");
    let assistantText = messageText(latestDraft);
    let checkpointFingerprint = runCheckpointFingerprint(latestDraft);
    let latestMessageMetadata: unknown;
    this.setStatus(sessionId, "streaming", runId);
    try {
      for await (const message of readUIMessageStream({ message: resumedAssistant, stream })) {
        const draft = normalizeRunMessage(message, runId);
        latestDraft = draft;
        this.drafts.set(sessionId, draft);
        if (draft.metadata !== undefined) latestMessageMetadata = draft.metadata;

        const nextAssistantText = messageText(draft);
        if (
          nextAssistantText.startsWith(assistantText) &&
          nextAssistantText.length > assistantText.length
        ) {
          const delta = nextAssistantText.slice(assistantText.length);
          this.events.publish({
            type: "message.delta",
            sessionId,
            runId,
            messageId: draft.id,
            delta,
          });
        }
        assistantText = nextAssistantText;

        const nextCheckpointFingerprint = runCheckpointFingerprint(draft);
        if (nextCheckpointFingerprint && nextCheckpointFingerprint !== checkpointFingerprint) {
          checkpointFingerprint = nextCheckpointFingerprint;
          await this.persistRunCheckpoint(sessionId, runId, startedAt, draft);
          this.events.publish({
            type: "message.updated",
            sessionId,
            runId,
            messageId: draft.id,
            message: draft,
          });
        }
      }
      const completedMessages = getCompletedMessages();
      let persistedMessages = completedMessages
        ? normalizeCompletedMessages(completedMessages, runId)
        : latestDraft.parts.length > 0
          ? mergeRunMessage(session.messages, latestDraft)
          : session.messages;
      const aborted = getRunAborted();
      if (aborted) {
        let interrupted = false;
        persistedMessages = persistedMessages.map((message, index) => {
          if (interrupted || message.role !== "assistant") return message;
          const hasLaterAssistant = persistedMessages
            .slice(index + 1)
            .some((candidate) => candidate.role === "assistant");
          if (hasLaterAssistant) return message;
          interrupted = true;
          return interruptRunMessage(message, "用户已停止运行");
        });
      }
      const completion = evaluateRunCompletion({
        planMode,
        planWritten: metrics.planWritten,
        finalText: terminal.text,
        finishReason: terminal.finishReason,
        terminalObserved: terminal.observed,
        aborted,
        forcedStopReason: metrics.forcedStopReason,
      });
      const runSummary: ChatRunSummary = {
        runId,
        outcome: completion.outcome,
        ...(completion.stopReason ? { stopReason: completion.stopReason } : {}),
        stepCount: metrics.stepCount,
        modelCallCount: metrics.modelCallCount,
        toolCallCount: metrics.toolCallCount,
        duplicateToolCallCount: metrics.duplicateToolCallCount,
        compactionCount: metrics.compactionCount,
        planWritten: metrics.planWritten,
      };
      if (completion.outcome === "error" && !latestAssistantText(persistedMessages).trim()) {
        persistedMessages = mergeRunMessage(
          persistedMessages,
          assistantMessage(
            runId,
            metrics.failureMessage ??
              `运行未完整结束：${completion.stopReason ?? "incomplete-response"}`,
          ),
        );
      }
      const nextMessages = mergeLatestMessageMetadata(persistedMessages, {
        ...(isRecord(latestMessageMetadata) ? latestMessageMetadata : {}),
        ...(metrics.usage ? { usage: metrics.usage } : {}),
        runSummary,
      });
      const current = (await this.store.get(sessionId)) ?? session;
      const updated: ChatSession = {
        ...current,
        messages: nextMessages,
        updatedAt: new Date().toISOString(),
        title: deriveTitle(nextMessages),
      };
      await this.store.save(updated);
      this.drafts.delete(sessionId);
      const finalMessage = nextMessages[nextMessages.length - 1];
      this.events.publish({
        type: "message.updated",
        sessionId,
        runId,
        messageId: finalMessage?.id,
        message: finalMessage,
      });
      await this.logRunOutcome(runSummary).catch((error) => {
        console.error("Failed to persist Chat Server run outcome", error);
      });
      if (completion.outcome === "error") {
        this.setStatus(sessionId, "error", runId);
        this.events.publish({
          type: "run.error",
          sessionId,
          runId,
          error: `运行异常结束：${completion.stopReason ?? "incomplete-response"}`,
          runSummary,
        });
      } else {
        this.setStatus(sessionId, "ready", runId);
        this.events.publish({ type: "run.done", sessionId, runId, runSummary });
      }
    } catch (error) {
      const message = errorMessage(error);
      const stopped = controllerAborted(this.active.get(sessionId));
      const stopReason = stopped
        ? "user"
        : error instanceof RunFailure
          ? error.stopReason
          : "incomplete-response";
      const runSummary: ChatRunSummary = {
        runId,
        outcome: stopped ? "stopped" : "error",
        stopReason,
        stepCount: metrics.stepCount,
        modelCallCount: metrics.modelCallCount,
        toolCallCount: metrics.toolCallCount,
        duplicateToolCallCount: metrics.duplicateToolCallCount,
        compactionCount: metrics.compactionCount,
        planWritten: metrics.planWritten,
      };
      await this.activityLogs
        .append({
          level: stopped ? "warning" : "error",
          source: "Agent Run Diagnostic",
          message: stopped ? "运行消费已停止" : "运行消费异常",
          details: JSON.stringify({
            sessionId,
            runId,
            stepCount: metrics.stepCount,
            modelCallCount: metrics.modelCallCount,
            toolCallCount: metrics.toolCallCount,
            error: diagnosticError(error),
          }),
        })
        .catch((logError) => console.error("Failed to persist run diagnostic", logError));
      let interruptedDraft = interruptRunMessage(latestDraft, message);
      if (!messageText(interruptedDraft).trim()) {
        interruptedDraft = {
          ...interruptedDraft,
          parts: [
            ...interruptedDraft.parts,
            { type: "text", text: stopped ? "运行已由用户停止。" : `运行异常结束：${message}` },
          ],
        };
      }
      interruptedDraft = {
        ...interruptedDraft,
        metadata: {
          ...(isRecord(interruptedDraft.metadata) ? interruptedDraft.metadata : {}),
          ...(metrics.usage ? { usage: metrics.usage } : {}),
          runSummary,
        },
      };
      this.drafts.set(sessionId, interruptedDraft);
      await this.persistDraft(sessionId, interruptedDraft).catch((persistError) => {
        console.error("Failed to persist interrupted Chat Server run", persistError);
      });
      this.events.publish({
        type: "message.updated",
        sessionId,
        runId,
        messageId: interruptedDraft.id,
        message: interruptedDraft,
      });
      await this.logRunOutcome(runSummary).catch((logError) => {
        console.error("Failed to persist Chat Server run outcome", logError);
      });
      this.setStatus(sessionId, stopped ? "ready" : "error", runId);
      this.events.publish({
        type: stopped ? "run.done" : "run.error",
        sessionId,
        runId,
        ...(stopped ? {} : { error: message }),
        runSummary,
      });
    } finally {
      this.active.delete(sessionId);
      await this.journal.clear(runId).catch((error) => {
        console.error("Failed to clear Chat Server run journal", error);
      });
    }
  }

  private async logRunOutcome(summary: ChatRunSummary) {
    await this.activityLogs.append({
      level:
        summary.outcome === "error"
          ? "error"
          : summary.outcome === "stopped" || summary.outcome === "awaiting-user"
            ? "warning"
            : "success",
      source: "Agent Run",
      message: `运行 ${summary.runId} ${summary.outcome}`,
      details: JSON.stringify({
        runId: summary.runId,
        stepCount: summary.stepCount,
        modelCallCount: summary.modelCallCount,
        toolCallCount: summary.toolCallCount,
        duplicateToolCallCount: summary.duplicateToolCallCount,
        compactionCount: summary.compactionCount,
        stopReason: summary.stopReason,
      }),
    });
  }
}

function controllerAborted(run: ActiveRun | undefined) {
  return run?.controller.signal.aborted === true;
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
    onReadOnlyToolResult: NonNullable<Parameters<typeof createWorkspaceTools>[7]>;
  },
) {
  const cwd = input.cwd?.trim();
  if (!hasWorkspace(cwd)) return {};
  if (input.planMode === "plan") {
    const tools = createWorkspaceTools(
      cwd,
      input.sandboxMode ?? "ask",
      input.approvedEscalationToolCallIds,
      input.onSandboxBlocked,
      input.sandboxReadablePaths,
      input.preflightResults,
      input.developerToolPaths,
      input.onReadOnlyToolResult,
    );
    const selected = selectPlanWorkspaceToolNames(input.toolNames ?? []);
    return Object.fromEntries(selected.map((name) => [name, tools[name]]));
  }
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
    input.onReadOnlyToolResult,
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
