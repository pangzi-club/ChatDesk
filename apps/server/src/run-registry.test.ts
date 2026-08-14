import assert from "node:assert/strict";
import type { ModelMessage, UIMessage } from "ai";
import { test } from "vitest";
import {
  compactAgentContext,
  estimateModelMessageTokens,
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

test("compacts old reasoning and tool results after the token threshold", () => {
  const messages = [
    {
      role: "assistant",
      content: [
        { type: "reasoning", text: "private reasoning" },
        { type: "tool-call", toolCallId: "call-1", toolName: "read_file", input: {} },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "read_file",
          output: { type: "text", value: "large result".repeat(100) },
        },
      ],
    },
    { role: "user", content: [{ type: "text", text: "continue" }] },
    { role: "assistant", content: [{ type: "text", text: "working" }] },
    { role: "user", content: [{ type: "text", text: "finish" }] },
  ] as ModelMessage[];

  assert.equal(compactAgentContext(messages, estimateModelMessageTokens(messages)), undefined);

  const result = compactAgentContext(messages, 1);
  assert.ok(result);
  assert.ok(result.estimatedTokensAfter < result.estimatedTokensBefore);
  assert.equal(
    result.messages.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "tool-call" || part.type === "tool-result"),
    ),
    false,
  );
});

test("does not report compaction when pruning cannot reduce context", () => {
  const messages: ModelMessage[] = [
    { role: "user", content: [{ type: "text", text: "plain conversation" }] },
  ];
  assert.equal(compactAgentContext(messages, 1), undefined);
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
    contextCompaction: {
      count: 1,
      stepNumber: 2,
      estimatedTokensBefore: 120_000,
      estimatedTokensAfter: 48_000,
    },
  });

  assert.deepEqual(merged[1].metadata, {
    source: "stream",
    usage: { inputTokens: 120, outputTokens: 12 },
    contextCompaction: {
      count: 1,
      stepNumber: 2,
      estimatedTokensBefore: 120_000,
      estimatedTokensAfter: 48_000,
    },
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
