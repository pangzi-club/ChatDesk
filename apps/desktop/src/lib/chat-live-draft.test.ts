import type { UIMessage } from "ai";
import { expect, test } from "vitest";
import { appendLiveDraftText, mergeLiveDraft } from "./chat-live-draft";

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
