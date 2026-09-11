import type { UIMessage } from "ai";
import { expect, test } from "vitest";
import {
  appendLiveDraftText,
  createLiveDraftRenderBatcher,
  mergeLiveDraft,
} from "./chat-live-draft";

function createScheduler() {
  let nextId = 1;
  const callbacks = new Map<number, () => void>();
  return {
    scheduler: {
      set(callback: () => void) {
        const id = nextId++;
        callbacks.set(id, callback);
        return id as unknown as ReturnType<typeof setTimeout>;
      },
      clear(handle: ReturnType<typeof setTimeout>) {
        callbacks.delete(handle as unknown as number);
      },
    },
    runAll() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    get size() {
      return callbacks.size;
    },
  };
}

test("replaces a live message with the complete tool snapshot", () => {
  const messages: UIMessage[] = [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "read it" }] },
    { id: "run-1", role: "assistant", parts: [{ type: "text", text: "working" }] },
  ];
  const snapshot = {
    id: "run-1",
    role: "assistant",
    parts: [
      { type: "text", text: "working", state: "done" },
      {
        type: "tool-read_file",
        toolCallId: "tool-1",
        state: "output-available",
        input: { path: "README.md" },
        output: { content: "README" },
      },
    ],
  } as UIMessage;

  const merged = mergeLiveDraft(messages, snapshot);

  expect(merged).toHaveLength(2);
  expect(merged[1]).toEqual(snapshot);
});

test("appends resumed text after a completed tool without changing part order", () => {
  const snapshot = {
    id: "run-1",
    role: "assistant",
    parts: [
      {
        type: "tool-read_file",
        toolCallId: "tool-1",
        state: "output-available",
        input: { path: "README.md" },
        output: { content: "README" },
      },
    ],
  } as UIMessage;

  const updated = appendLiveDraftText(snapshot, "run-1", "Finished");

  expect(updated.parts[0].type).toBe("tool-read_file");
  expect(updated.parts[1]).toEqual({ type: "text", text: "Finished", state: "streaming" });
});

test("appends deltas to the current streaming text part", () => {
  const draft: UIMessage = {
    id: "run-1",
    role: "assistant",
    parts: [{ type: "text", text: "Work", state: "streaming" }],
  };

  const updated = appendLiveDraftText(draft, "run-1", "ing");

  expect(updated.parts).toEqual([{ type: "text", text: "Working", state: "streaming" }]);
});

test("batches repeated renders per session and keeps sessions independent", () => {
  const clock = createScheduler();
  const flushed: string[] = [];
  const batcher = createLiveDraftRenderBatcher(
    (sessionId) => flushed.push(sessionId),
    50,
    clock.scheduler,
  );

  batcher.schedule("one");
  batcher.schedule("one");
  batcher.schedule("two");

  expect(clock.size).toBe(2);
  clock.runAll();
  expect(flushed).toEqual(["one", "two"]);
});

test("renders the latest complete draft after several batched deltas", () => {
  const clock = createScheduler();
  let draft: UIMessage | undefined;
  let rendered = "";
  const batcher = createLiveDraftRenderBatcher(
    () => {
      rendered = draft?.parts.find((part) => part.type === "text")?.text ?? "";
    },
    50,
    clock.scheduler,
  );

  draft = appendLiveDraftText(draft, "run-1", "Work");
  batcher.schedule("one");
  draft = appendLiveDraftText(draft, "run-1", "ing");
  batcher.schedule("one");
  clock.runAll();

  expect(rendered).toBe("Working");
});

test("flushes pending work immediately and cancels delayed work", () => {
  const clock = createScheduler();
  const flushed: string[] = [];
  const batcher = createLiveDraftRenderBatcher(
    (sessionId) => flushed.push(sessionId),
    50,
    clock.scheduler,
  );

  batcher.schedule("one");
  batcher.flush("one");
  clock.runAll();

  expect(flushed).toEqual(["one"]);
});

test("cancelAll prevents updates after unmount", () => {
  const clock = createScheduler();
  const flushed: string[] = [];
  const batcher = createLiveDraftRenderBatcher(
    (sessionId) => flushed.push(sessionId),
    50,
    clock.scheduler,
  );

  batcher.schedule("one");
  batcher.schedule("two");
  batcher.cancelAll();
  clock.runAll();

  expect(flushed).toEqual([]);
});
