import { randomUUID } from "node:crypto";
import { createOpenAI } from "@ai-sdk/openai";
import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type UIMessage,
} from "ai";
import type { EventHub } from "./events.ts";
import { deriveTitle, type ChatSession, type RunStartInput, type SessionStatus } from "./protocol.ts";
import { SessionStore } from "./store.ts";
import { createWorkspaceTools } from "./workspace-tools.ts";

type ActiveRun = {
  id: string;
  sessionId: string;
  controller: AbortController;
};

function modelId(input: RunStartInput) {
  return input.model.name.trim();
}

function baseUrl(value: string) {
  return value.trim().replace(/\/+$/, "").replace(/\/chat\/completions$/i, "").replace(/\/responses$/i, "");
}

function assistantMessage(id: string, text: string): UIMessage {
  return { id, role: "assistant", parts: text ? [{ type: "text", text }] : [] };
}

export class RunRegistry {
  private readonly active = new Map<string, ActiveRun>();
  private readonly statuses = new Map<string, SessionStatus>();
  private readonly drafts = new Map<string, UIMessage>();
  private readonly store: SessionStore;
  private readonly events: EventHub;

  constructor(store: SessionStore, events: EventHub) {
    this.store = store;
    this.events = events;
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
    if (!input.model?.apiKey || !input.model.baseUrl || !input.model.name) {
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
      modelId: input.model.id || input.model.name,
      workspaceId: input.workspaceId ?? current.workspaceId,
      cwd: input.cwd ?? current.cwd,
      messages,
    };
    await this.store.save(session);

    const runId = randomUUID();
    const controller = new AbortController();
    this.active.set(sessionId, { id: runId, sessionId, controller });
    this.drafts.set(sessionId, assistantMessage(runId, ""));
    this.setStatus(sessionId, "submitted", runId);

    const provider = createOpenAI({ apiKey: input.model.apiKey, baseURL: baseUrl(input.model.baseUrl) });
    const languageModel = input.model.responsive
      ? provider.responses(modelId(input))
      : provider.chat(modelId(input));
    const modelMessages = await convertToModelMessages(messages);
    const system = [input.system, input.memory, input.cwd ? `当前 workspace：${input.cwd}` : ""]
      .filter(Boolean)
      .join("\n\n");
    const result = streamText({
      model: languageModel,
      messages: modelMessages,
      ...(system ? (input.model.responsive ? { instructions: system } : { system }) : {}),
      tools: input.model.supportsTools && input.cwd ? createWorkspaceTools(input.cwd) : undefined,
      stopWhen: stepCountIs(20),
      abortSignal: controller.signal,
    });
    let completedMessages: UIMessage[] | undefined;
    const uiStream = result.toUIMessageStream({
      originalMessages: messages,
      onFinish: ({ messages: finishedMessages }) => {
        completedMessages = finishedMessages;
      },
    });
    const [clientStream, observerStream] = uiStream.tee();
    void this.consume(session, runId, observerStream, () => completedMessages);
    return createUIMessageStreamResponse({ stream: clientStream });
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
      const message = error instanceof Error ? error.message : String(error);
      this.setStatus(sessionId, "error", runId);
      this.events.publish({ type: "run.error", sessionId, runId, error: message });
    } finally {
      this.active.delete(sessionId);
    }
  }
}
