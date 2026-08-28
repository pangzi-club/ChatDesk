import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { describe, it } from "vitest";
import {
  buildCheckpointPrompt,
  checkpointInstructions,
  createContextCompactionStrategy,
  estimateAgentContextTokens,
  retainRecentModelMessages,
} from "./agent-context.ts";

describe("semantic checkpoint context", () => {
  it("excludes reasoning and includes the plan verbatim", () => {
    const messages = [
      { role: "user", content: [{ type: "text", text: "fix it" }] },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "hidden chain" },
          { type: "text", text: "visible fact" },
        ],
      },
    ] as ModelMessage[];
    const prompt = buildCheckpointPrompt({ messages, planContent: "# Exact plan\nDo A" });
    assert.doesNotMatch(prompt, /hidden chain/);
    assert.match(prompt, /visible fact/);
    assert.match(prompt, /# Exact plan\nDo A/);
  });

  it("keeps recent messages and counts checkpoint instructions in the estimate", () => {
    const messages = Array.from({ length: 10 }, (_, index) => ({
      role: index % 2 ? "assistant" : "user",
      content: [{ type: "text", text: `message-${index}` }],
    })) as ModelMessage[];
    const recent = retainRecentModelMessages(messages);
    assert.ok(recent.length <= 6);
    const instructions = checkpointInstructions({
      base: "base",
      checkpoint: "checkpoint".repeat(100),
      planContent: "plan body",
    });
    assert.ok(
      estimateAgentContextTokens(recent, instructions) > estimateAgentContextTokens(recent, ""),
    );
    assert.match(instructions, /plan body/);
  });

  it("defaults to semantic checkpoint compaction", () => {
    assert.equal(createContextCompactionStrategy(undefined).kind, "semantic-checkpoint");
  });

  it("compacts by recent message time and preserves undated messages", async () => {
    const now = new Date("2026-08-28T12:00:00.000Z");
    const messages = [
      { role: "user", content: "old" },
      { role: "assistant", content: "expired" },
      { role: "user", content: "recent" },
    ] as ModelMessage[];
    const createdAt = [undefined, "2026-08-28T11:00:00.000Z", "2026-08-28T11:45:00.000Z"];
    const result = await createContextCompactionStrategy("recent-time").compact({
      messages,
      now,
      windowMinutes: 30,
      getMessageCreatedAt: (message) => createdAt[messages.indexOf(message)],
      generateCheckpoint: async () => "unused",
    });
    assert.deepEqual(result.messages, [messages[0], messages[2]]);
    assert.equal(result.droppedMessageCount, 1);
    assert.equal(result.cutoffAt, "2026-08-28T11:30:00.000Z");
  });

  it("falls back to the default window for invalid durations", async () => {
    const message = { role: "user", content: "old" } as ModelMessage;
    const result = await createContextCompactionStrategy("recent-time").compact({
      messages: [message],
      now: new Date("2026-08-28T12:00:00.000Z"),
      windowMinutes: 0,
      getMessageCreatedAt: () => "2026-08-28T11:40:00.000Z",
      generateCheckpoint: async () => "unused",
    });
    assert.deepEqual(result.messages, [message]);
    assert.equal(result.droppedMessageCount, 0);
  });
});
