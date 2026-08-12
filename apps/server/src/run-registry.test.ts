import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import { test } from "vitest";
import {
  MAX_AGENT_STEPS,
  mergeLatestMessageMetadata,
  normalizeCompletedMessages,
  reachedToolLimit,
} from "./run-registry.ts";

test("uses 30 steps as the tool loop limit", () => {
  assert.equal(MAX_AGENT_STEPS, 30);
  assert.equal(reachedToolLimit(30, "tool-calls"), true);
  assert.equal(reachedToolLimit(29, "tool-calls"), false);
  assert.equal(reachedToolLimit(30, "stop"), false);
});

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

test("normalizeCompletedMessages assigns the run id to an empty final assistant id", () => {
  const messages: UIMessage[] = [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
    { id: "", role: "assistant", parts: [{ type: "text", text: "hi" }] },
  ];

  const normalized = normalizeCompletedMessages(messages, "run-1");

  assert.equal(normalized[1].id, "run-1");
  assert.equal(messages[1].id, "");
});
