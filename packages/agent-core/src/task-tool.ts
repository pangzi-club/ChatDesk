import { randomUUID } from "node:crypto";
import {
  type ChatRunOutcome,
  type ChatSession,
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
  options: { aborted?: boolean; error?: string } = {},
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
  const progress = session
    ? extractCreateTaskProgress(session.messages)
    : { headings: [], tools: [] };
  return {
    sessionId,
    title: session?.title || title,
    status,
    preview: session ? previewFromSession(session) : "",
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
  return tool({
    description: [
      "把独立子任务交给一个不可交互的后台会话执行，并等待它完成后返回摘要。",
      "适合互不依赖、可并行的调研、搜索或改动；不要用于需要用户中途决策的工作。",
      "同一轮可以多次调用以并行启动多个 task。",
    ].join(""),
    inputSchema: z.object({
      prompt: z.string().min(1).max(20_000).describe("交给后台会话的完整任务说明"),
      title: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe("侧栏显示的短标题；缺省时从任务说明生成"),
    }),
    execute: async function* ({ prompt, title }, { abortSignal }) {
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
        parentSessionId: context.parentSessionId,
        modelId: parent?.modelId,
        workspaceId: context.parentInput.workspaceId ?? parent?.workspaceId,
        cwd: context.parentInput.cwd ?? parent?.cwd,
        sandboxMode: context.parentInput.sandboxMode ?? parent?.sandboxMode,
        mcpServerIds: context.parentInput.mcpServerIds ?? parent?.mcpServerIds,
        skillIds: context.parentInput.skillIds ?? parent?.skillIds,
        messages: [user],
        attachments: [],
        planMode: "apply",
      };
      await context.store.save(session);
      context.runner.trackSpawnedTask(context.parentSessionId, sessionId);
      const subscription = context.events.subscribe(sessionId);
      const takeSnapshot = (options?: { aborted?: boolean; error?: string }) =>
        snapshotCreateTask(context.store, context.runner, sessionId, resolvedTitle, options);

      try {
        await context.runner.startDetached(sessionId, {
          ...context.parentInput,
          messages: [user],
          title: resolvedTitle,
          toolNames: (context.parentInput.toolNames ?? []).filter(
            (name) => name !== CREATE_TASK_TOOL_NAME,
          ),
          planMode: "apply",
          planId: undefined,
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
          const stopped = await takeSnapshot({ aborted: true });
          yield stopped;
          return stopped;
        }
        await context.runner.waitForRun(sessionId);
        const completed = await takeSnapshot();
        yield completed;
        return completed;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (signal.aborted) {
          await context.runner.stop(sessionId);
          const stopped = await takeSnapshot({ aborted: true, error: message });
          yield stopped;
          return stopped;
        }
        const failed = await takeSnapshot({ error: message || "任务启动失败" });
        yield failed;
        return failed;
      } finally {
        subscription.close();
      }
    },
  });
}
