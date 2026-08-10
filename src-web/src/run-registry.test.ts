import assert from "node:assert/strict";
import test from "node:test";
import type { UIMessage } from "ai";
import { mergeLatestMessageMetadata } from "./run-registry.ts";

test("mergeLatestMessageMetadata persists usage on the latest assistant message", () => {
  const messages: UIMessage[] = [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "hi" }],
      metadata: { source: "stream" },
    },
  ];

  const merged = mergeLatestMessageMetadata(messages, {
    usage: { inputTokens: 120, outputTokens: 12 },
  });

  assert.deepEqual(merged[1].metadata, {
    source: "stream",
    usage: { inputTokens: 120, outputTokens: 12 },
  });
  assert.equal((messages[1].metadata as { usage?: unknown } | undefined)?.usage, undefined);
});
