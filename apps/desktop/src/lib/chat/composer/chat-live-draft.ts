import type { UIMessage } from "ai";

export const CHAT_STREAM_UPDATE_THROTTLE_MS = 50;

type TimerHandle = ReturnType<typeof setTimeout>;

type LiveDraftRenderScheduler = {
  set: (callback: () => void, delayMs: number) => TimerHandle;
  clear: (handle: TimerHandle) => void;
};

const DEFAULT_SCHEDULER: LiveDraftRenderScheduler = {
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle),
};

export function createLiveDraftRenderBatcher(
  onFlush: (sessionId: string) => void,
  delayMs: number,
  scheduler: LiveDraftRenderScheduler = DEFAULT_SCHEDULER,
) {
  const pending = new Set<string>();
  const timers = new Map<string, TimerHandle>();

  const flush = (sessionId: string) => {
    const timer = timers.get(sessionId);
    if (timer !== undefined) {
      scheduler.clear(timer);
      timers.delete(sessionId);
    }
    if (!pending.delete(sessionId)) return;
    onFlush(sessionId);
  };

  return {
    schedule(sessionId: string) {
      pending.add(sessionId);
      if (timers.has(sessionId)) return;
      timers.set(
        sessionId,
        scheduler.set(() => flush(sessionId), delayMs),
      );
    },
    flush,
    cancel(sessionId: string) {
      const timer = timers.get(sessionId);
      if (timer !== undefined) scheduler.clear(timer);
      timers.delete(sessionId);
      pending.delete(sessionId);
    },
    cancelAll() {
      for (const timer of timers.values()) scheduler.clear(timer);
      timers.clear();
      pending.clear();
    },
  };
}

export function mergeLiveDraft(messages: UIMessage[], draft: UIMessage | undefined) {
  if (!draft?.id || draft.parts.length === 0) return messages;
  const existingIndex = messages.findIndex((message) => message.id === draft.id);
  if (existingIndex < 0) return [...messages, draft];
  return messages.map((message, index) => (index === existingIndex ? draft : message));
}

export function appendLiveDraftText(
  draft: UIMessage | undefined,
  messageId: string,
  delta: string,
) {
  const current: UIMessage =
    draft?.id === messageId ? draft : { id: messageId, role: "assistant", parts: [] };
  const parts = [...current.parts];
  const lastPart = parts[parts.length - 1];
  if (lastPart?.type === "text" && lastPart.state !== "done") {
    parts[parts.length - 1] = { ...lastPart, text: `${lastPart.text}${delta}` };
  } else {
    parts.push({ type: "text", text: delta, state: "streaming" });
  }
  return { ...current, parts };
}
