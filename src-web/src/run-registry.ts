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
import { deriveTitle, type ChatSession, type RunStartInput, type SessionStatus } from "./protocol.ts";
import { SessionStore } from "./store.ts";
import { createWorkspaceTools } from "./workspace-tools.ts";
import type { ChatConfigStore } from "./chat-config.ts";
import { createBusinessTools } from "./business-tools.ts";
import { openai } from "@ai-sdk/openai";
import { RunJournal } from "./run-journal.ts";

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
    const model = resolveConfiguredModel(this.chatConfig.get(), input);
    if (!model?.apiKey || !model.baseUrl || !model.name) {
      throw new Error("模型配置不完整");
    }

    const current = await this.store.get(sessionId);
    if (!current) throw new Error("会话不存在");
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
              ...createWorkspaceToolsForInput({ ...input, model }),
              ...selectTools(createBusinessTools(this.chatConfig.get().apiKeys), input.toolNames),
              ...(input.toolNames?.includes("web_search") && model.responsive
                ? { web_search: openai.tools.webSearch({}) as unknown as ToolSet[string] }
                : {}),
            }
          : undefined,
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

function createWorkspaceToolsForInput(input: RunStartInput) {
  if (!input.cwd) return {};
  const names = new Set(input.toolNames ?? []);
  if (!["list_dir", "search_files", "read_file", "write_file", "edit_file", "terminal", "bash"].some((name) => names.has(name))) return {};
  const tools = createWorkspaceTools(input.cwd);
  const selected = names.has("terminal") ? ["bash"] : ["list_dir", "search_files", "read_file", "write_file", "edit_file", "bash"];
  return Object.fromEntries(selected.filter((name) => names.has(name) || (name === "bash" && names.has("terminal"))).map((name) => [name, tools[name]]));
}

function selectTools(tools: Record<string, unknown>, names: string[] | undefined) {
  const selected = new Set(names ?? []);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => selected.has(name)));
}
