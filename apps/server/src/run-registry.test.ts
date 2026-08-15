import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import { test } from "vitest";
import {
  interruptRunMessage,
  MAX_AGENT_STEPS,
  MODEL_CALL_MAX_RETRIES,
  mergeLatestMessageMetadata,
  mergeRunMessage,
  normalizeCompletedMessages,
  runCheckpointFingerprint,
} from "./run-registry.ts";

test("allows long agent runs without automatically retrying model failures", () => {
  assert.equal(MAX_AGENT_STEPS, 100);
  assert.equal(MODEL_CALL_MAX_RETRIES, 0);
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

test("checkpoints complete content and tool state transitions", () => {
  const streamingText: UIMessage = {
    id: "run-1",
    role: "assistant",
    parts: [{ type: "text", text: "partial", state: "streaming" }],
  };
  assert.equal(runCheckpointFingerprint(streamingText), "");

  const completeText: UIMessage = {
    ...streamingText,
    parts: [{ type: "text", text: "complete", state: "done" }],
  };
  assert.notEqual(runCheckpointFingerprint(completeText), "");

  const runningTool = {
    id: "run-1",
    role: "assistant",
    parts: [
      {
        type: "tool-read_file",
        toolCallId: "tool-1",
        state: "input-available",
        input: { path: "README.md" },
      },
    ],
  } as UIMessage;
  const completedTool = {
    ...runningTool,
    parts: [
      {
        ...runningTool.parts[0],
        state: "output-available",
        output: { content: "README" },
      },
    ],
  } as UIMessage;
  assert.notEqual(runCheckpointFingerprint(runningTool), "");
  assert.notEqual(runCheckpointFingerprint(completedTool), runCheckpointFingerprint(runningTool));
});

test("replaces a run checkpoint without duplicating the assistant message", () => {
  const messages: UIMessage[] = [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
    { id: "run-1", role: "assistant", parts: [{ type: "text", text: "old" }] },
  ];
  const draft: UIMessage = {
    id: "run-1",
    role: "assistant",
    parts: [{ type: "text", text: "new" }],
  };

  const merged = mergeRunMessage(messages, draft);

  assert.equal(merged.length, 2);
  assert.deepEqual(merged[1], draft);
});

test("marks pending tools as failed when a persisted run is interrupted", () => {
  const message = {
    id: "run-1",
    role: "assistant",
    parts: [
      { type: "text", text: "working", state: "streaming" },
      {
        type: "tool-read_file",
        toolCallId: "tool-1",
        state: "input-available",
        input: { path: "README.md" },
      },
    ],
  } as UIMessage;

  const interrupted = interruptRunMessage(message, "server restarted");
  const text = interrupted.parts[0];
  const tool = interrupted.parts[1];

  assert.equal(text.type === "text" ? text.state : undefined, "done");
  assert.equal("state" in tool ? tool.state : undefined, "output-error");
  assert.equal("errorText" in tool ? tool.errorText : undefined, "server restarted");
});
