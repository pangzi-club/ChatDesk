import { randomUUID } from "node:crypto";
import {
  type ChatRunOutcome,
  type ChatSession,
  CREATE_TASK_RESULT_MAX_CHARS,
  CREATE_TASK_TOOL_NAME,
  type CreateTaskOutput,
  type CreateTaskPreviewMessage,
  type CreateTaskStatus,
  deriveTitle,
  extractCreateTaskProgress,
  type RunStartInput,
  type SessionStatus,
  textFromMessage,
} from "@chatdesk/shared";
import { tool, type UIMessage } from "ai";
import { z } from "zod";
import type { EventHub } from "./events.ts";
import type { SessionStore } from "./store.ts";

export const CREATE_TASK_TOOL_INSTRUCTIONS = [
  "任务委派规则：遇到可并行、互不依赖、且不需要用户中途决策的子任务时，使用 create_task 交给独立后台会话执行。",
  "同一轮里可以多次调用 create_task；互不依赖的子任务必须在同一步并行发起，不要等前一个完成再创建下一个。",
  "每个 task 会话与当前对话能力相同，但不能交互、不能再创建 task，也不要派需要用户确认、选择或补充信息的工作。",
  "create_task 会等到该子任务结束后才返回结果；根据返回的 preview / outcome 汇总，不要假设它已在后台悄悄完成。",
].join("\n");

const PREVIEW_MAX_CHARS = 240;
const PREVIEW_MESSAGE_LIMIT = 4;
const RESULT_TRUNCATION_MARKER = "\n\n[结果已截断]";

export type CreateTaskTargetInput = {
  agentId?: string;
  workspaceId?: string;
};

export type CreateTaskTargetResolution = {
  agentId?: string;
  runInput: Partial<RunStartInput>;
};

export type CreateTaskTargeting = {
  description: string;
  resolve: (
    input: CreateTaskTargetInput,
  ) => CreateTaskTargetResolution | Promise<CreateTaskTargetResolution>;
};

export type CreateTaskRunner = {
  startDetached(sessionId: string, input: RunStartInput): Promise<string>;
  isActive(sessionId: string): boolean;
  statusOf(sessionId: string): SessionStatus;
  waitForRun(sessionId: string): Promise<void>;
  stop(sessionId: string): Promise<boolean>;
  trackSpawnedTask(parentSessionId: string, childSessionId: string): void;
};

export type CreateTaskToolContext = {
  store: SessionStore;
  events: EventHub;
  runner: CreateTaskRunner;
  parentSessionId: string;
  parentInput: RunStartInput;
  targeting?: CreateTaskTargeting;
  resultMaxChars?: number;
};

function truncatePreview(text: string) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= PREVIEW_MAX_CHARS) return normalized;
  return `${normalized.slice(0, PREVIEW_MAX_CHARS).trimEnd()}…`;
}

function latestRunSummary(session: ChatSession) {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const metadata = session.messages[index]?.metadata;
    if (!metadata || typeof metadata !== "object") continue;
    const runSummary = (metadata as { runSummary?: { outcome?: ChatRunOutcome } }).runSummary;
    if (runSummary?.outcome) return runSummary;
  }
  return undefined;
}

function previewMessages(session: ChatSession): CreateTaskPreviewMessage[] {
  return session.messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => ({
      role: message.role as "user" | "assistant",
      text: textFromMessage(message),
    }))
    .filter((message) => message.text.trim())
    .slice(-PREVIEW_MESSAGE_LIMIT)
    .map((message) => ({ ...message, text: truncatePreview(message.text) }));
}

function previewFromSession(session: ChatSession) {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message?.role !== "assistant") continue;
    const text = textFromMessage(message).trim();
    if (text) return truncatePreview(text);
  }
  return "";
}

function resultFromSession(session: ChatSession, maxChars: number) {
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const message = session.messages[index];
    if (message?.role !== "assistant") continue;
    const text = textFromMessage(message).trim();
    if (!text) continue;
    if (text.length <= maxChars) return text;
    const contentMaxChars = Math.max(0, maxChars - RESULT_TRUNCATION_MARKER.length);
    return `${text.slice(0, contentMaxChars).trimEnd()}${RESULT_TRUNCATION_MARKER}`;
  }
  return "";
}

function resolveCreateTaskStatus(input: {
  session: ChatSession | null;
  active: boolean;
  status: SessionStatus;
  aborted: boolean;
}): CreateTaskStatus {
  if (input.aborted) return "stopped";
  if (input.active) return "running";
  const outcome = input.session ? latestRunSummary(input.session)?.outcome : undefined;
  if (outcome === "stopped") return "stopped";
  if (outcome === "error" || input.status === "error") return "error";
  return "completed";
}

async function snapshotCreateTask(
  store: SessionStore,
  runner: CreateTaskRunner,
  sessionId: string,
  title: string,
  options: { aborted?: boolean; error?: string; resultMaxChars?: number } = {},
): Promise<CreateTaskOutput> {
  const session = await store.get(sessionId);
  const aborted = options.aborted === true;
  const active = runner.isActive(sessionId);
  let status = resolveCreateTaskStatus({
    session,
    active,
    status: runner.statusOf(sessionId),
    aborted,
  });
  if (options.error && !aborted && !active) status = "error";
  const outcome = session ? latestRunSummary(session)?.outcome : undefined;
  const messages = session ? previewMessages(session) : [];
  const result =
    session && options.resultMaxChars
      ? resultFromSession(session, Math.min(options.resultMaxChars, CREATE_TASK_RESULT_MAX_CHARS))
      : "";
  const progress = session
    ? extractCreateTaskProgress(session.messages)
    : { headings: [], tools: [] };
  return {
    sessionId,
    title: session?.title || title,
    status,
    preview: session ? previewFromSession(session) : "",
    ...(result ? { result } : {}),
    ...(progress.headings.length > 0 ? { headings: progress.headings } : {}),
    ...(progress.tools.length > 0 ? { tools: progress.tools } : {}),
    ...(outcome ? { outcome } : {}),
    ...(options.error ? { error: options.error } : {}),
    ...(messages.length > 0 ? { messages } : {}),
  };
}

function userMessage(prompt: string): UIMessage {
  return {
    id: randomUUID(),
    role: "user",
    parts: [{ type: "text", text: prompt }],
  };
}

export function createTaskTool(context: CreateTaskToolContext) {
  const baseInputSchema = z.object({
    prompt: z.string().min(1).max(20_000).describe("交给后台会话的完整任务说明"),
    title: z.string().min(1).max(80).optional().describe("侧栏显示的短标题；缺省时从任务说明生成"),
  });
  const inputSchema = context.targeting
    ? baseInputSchema.extend({
        agentId: z.string().min(1).optional().describe("执行任务的 Agent ID；省略时继承当前 Agent"),
        workspaceId: z
          .string()
          .min(1)
          .optional()
          .describe("执行任务的 Workspace ID；省略时使用独立的 Default Workspace 目录"),
      })
    : baseInputSchema;
  return tool({
    description: [
      "把独立子任务交给一个不可交互的后台会话执行，并等待它完成后返回摘要。",
      "适合互不依赖、可并行的调研、搜索或改动；不要用于需要用户中途决策的工作。",
      "同一轮可以多次调用以并行启动多个 task。",
      context.targeting?.description,
    ].join(""),
    inputSchema,
    execute: async function* (rawInput, { abortSignal }) {
      const input = rawInput as z.infer<typeof baseInputSchema> & CreateTaskTargetInput;
      const { prompt, title } = input;
      const target = context.targeting
        ? await context.targeting.resolve({
            agentId: input.agentId,
            workspaceId: input.workspaceId,
          })
        : undefined;
      const taskInput = target
        ? { ...context.parentInput, ...target.runInput }
        : context.parentInput;
      const signal = abortSignal ?? new AbortController().signal;
      const now = new Date().toISOString();
      const sessionId = randomUUID();
      const user = userMessage(prompt);
      const resolvedTitle = title?.trim() || deriveTitle([user]);
      const parent = await context.store.get(context.parentSessionId);
      const session: ChatSession = {
        schemaVersion: 2,
        id: sessionId,
        title: resolvedTitle,
        createdAt: now,
        updatedAt: now,
        kind: "task",
        source: parent?.source,
        parentSessionId: context.parentSessionId,
        ...(target?.agentId ? { agentId: target.agentId } : {}),
        modelId: taskInput.modelId ?? parent?.modelId,
        workspaceId: target
          ? taskInput.workspaceId
          : (context.parentInput.workspaceId ?? parent?.workspaceId),
        cwd: target ? taskInput.cwd : (context.parentInput.cwd ?? parent?.cwd),
        sandboxMode: "full",
        mcpServerIds: taskInput.mcpServerIds ?? parent?.mcpServerIds,
        skillIds: taskInput.skillIds ?? parent?.skillIds,
        messages: [user],
        attachments: [],
        planMode: "apply",
      };
      await context.store.save(session);
      context.runner.trackSpawnedTask(context.parentSessionId, sessionId);
      const subscription = context.events.subscribe(sessionId);
      const takeSnapshot = (options?: {
        aborted?: boolean;
        error?: string;
        resultMaxChars?: number;
      }) => snapshotCreateTask(context.store, context.runner, sessionId, resolvedTitle, options);

      try {
        await context.runner.startDetached(sessionId, {
          ...taskInput,
          messages: [user],
          title: resolvedTitle,
          toolNames: (taskInput.toolNames ?? []).filter((name) => name !== CREATE_TASK_TOOL_NAME),
          planMode: "apply",
          planId: undefined,
          sandboxMode: "full",
        });
        yield await takeSnapshot();
        while (context.runner.isActive(sessionId) && !signal.aborted) {
          await Promise.race([
            subscription.next(1_000),
            context.runner.waitForRun(sessionId).then(() => null),
          ]);
          yield await takeSnapshot({ aborted: signal.aborted });
        }
        if (signal.aborted) {
          await context.runner.stop(sessionId);
          const stopped = await takeSnapshot({
            aborted: true,
            resultMaxChars: context.resultMaxChars,
          });
          yield stopped;
          return stopped;
        }
        await context.runner.waitForRun(sessionId);
        const completed = await takeSnapshot({ resultMaxChars: context.resultMaxChars });
        yield completed;
        return completed;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (signal.aborted) {
          await context.runner.stop(sessionId);
          const stopped = await takeSnapshot({
            aborted: true,
            error: message,
            resultMaxChars: context.resultMaxChars,
          });
          yield stopped;
          return stopped;
        }
        const failed = await takeSnapshot({
          error: message || "任务启动失败",
          resultMaxChars: context.resultMaxChars,
        });
        yield failed;
        return failed;
      } finally {
        subscription.close();
      }
    },
  });
}
