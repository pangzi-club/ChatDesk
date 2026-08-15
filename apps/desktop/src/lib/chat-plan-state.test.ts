import type { ChatRunSummary } from "@chatdesk/shared";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  findLatestPlanWriteAnchor,
  findLatestPlanWriteContent,
  isPlanExecutionReady,
  lastAssistantMessageHasCompletedPlanInput,
  latestAssistantHasPlanWrite,
} from "./chat-plan-state";

function assistantWithSummary(
  outcome: "completed" | "awaiting-user",
  planWritten: boolean,
): UIMessage {
  return {
    id: `assistant-${outcome}`,
    role: "assistant",
    parts: [{ type: "text", text: "done" }],
    metadata: {
      runSummary: {
        runId: "run-1",
        outcome,
        stepCount: 1,
        modelCallCount: 1,
        toolCallCount: 1,
        duplicateToolCallCount: 0,
        compactionCount: 0,
        planWritten,
      },
    },
  };
}

describe("chat plan state", () => {
  it("extracts live markdown from a streaming plan_write input", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant-plan",
        role: "assistant",
        parts: [
          {
            type: "tool-plan_write",
            toolCallId: "plan-call",
            state: "input-streaming",
            input: { content: "# Live plan" },
          },
        ],
      },
    ];
    expect(findLatestPlanWriteContent(messages)).toBe("# Live plan");
    expect(latestAssistantHasPlanWrite(messages)).toBe(true);
    expect(
      latestAssistantHasPlanWrite([
        { id: "assistant-text", role: "assistant", parts: [{ type: "text", text: "调研中" }] },
      ]),
    ).toBe(false);
  });

  it("anchors the active plan to the latest plan_write tool call", () => {
    const messages: UIMessage[] = [
      {
        id: "assistant-plan-old",
        role: "assistant",
        parts: [
          {
            type: "tool-plan_write",
            toolCallId: "plan-call-old",
            state: "output-available",
            input: { content: "# Old plan" },
            output: { characters: 10 },
          },
        ],
      },
      { id: "user-follow-up", role: "user", parts: [{ type: "text", text: "revise it" }] },
      {
        id: "assistant-plan-latest",
        role: "assistant",
        parts: [
          {
            type: "tool-plan_write",
            toolCallId: "plan-call-latest",
            state: "output-available",
            input: { content: "# Latest plan" },
            output: { characters: 13 },
          },
          { type: "text", text: "Plan updated." },
        ],
      },
      { id: "user-after-plan", role: "user", parts: [{ type: "text", text: "thanks" }] },
    ];

    expect(findLatestPlanWriteAnchor(messages)).toEqual({
      messageId: "assistant-plan-latest",
      toolCallId: "plan-call-latest",
    });
  });

  it("only enables execution from the completed server run summary", () => {
    const completed = (
      assistantWithSummary("completed", true).metadata as { runSummary: ChatRunSummary }
    ).runSummary;
    const awaitingUser = (
      assistantWithSummary("awaiting-user", false).metadata as { runSummary: ChatRunSummary }
    ).runSummary;
    expect(isPlanExecutionReady("plan", true, completed)).toBe(true);
    expect(isPlanExecutionReady("plan", true, awaitingUser)).toBe(false);
    expect(isPlanExecutionReady("apply", true, completed)).toBe(false);
    expect(isPlanExecutionReady("plan", false, completed)).toBe(false);
  });

  it("only auto-continues a completed request_user_input in the latest step", () => {
    const answered: UIMessage = {
      id: "assistant-question",
      role: "assistant",
      parts: [
        { type: "step-start" },
        {
          type: "tool-request_user_input",
          toolCallId: "question-call",
          state: "output-available",
          input: { questions: [] },
          output: { answers: [] },
        },
      ],
    };
    expect(lastAssistantMessageHasCompletedPlanInput([answered])).toBe(true);
    expect(
      lastAssistantMessageHasCompletedPlanInput([
        {
          ...answered,
          parts: [...answered.parts, { type: "step-start" }, { type: "text", text: "continued" }],
        },
      ]),
    ).toBe(false);
  });
});
