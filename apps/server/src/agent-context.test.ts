import assert from "node:assert/strict";
import type { ModelMessage } from "ai";
import { describe, it } from "vitest";
import {
  buildCheckpointPrompt,
  checkpointInstructions,
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
});
