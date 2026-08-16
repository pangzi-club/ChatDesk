import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  formatElapsedDuration,
  formatMessageRunDuration,
  getMessageContextUsage,
  getMessageRunErrorLabel,
  getMessageRunStateLabel,
} from "./chat-usage";

describe("message context usage", () => {
  it("prefers the latest per-step provider measurement over aggregate usage", () => {
    expect(
      getMessageContextUsage({
        id: "assistant-1",
        role: "assistant",
        parts: [],
        metadata: {
          usage: { inputTokens: 240_000 },
          contextUsage: { inputTokens: 48_500, source: "provider", stepNumber: 3 },
        },
      }),
    ).toEqual({ inputTokens: 48_500, source: "provider", stepNumber: 3 });
  });

  it("restores an estimate from persisted compaction metadata", () => {
    expect(
      getMessageContextUsage({
        id: "assistant-1",
        role: "assistant",
        parts: [],
        metadata: {
          contextCompaction: {
            count: 1,
            stepNumber: 2,
            estimatedTokensBefore: 120_000,
            estimatedTokensAfter: 42_000,
          },
        },
      }),
    ).toEqual({ inputTokens: 42_000, source: "estimate", stepNumber: 2 });
  });
});

describe("run state labels", () => {
  it("marks legacy tool-only assistant messages as incomplete", () => {
    const message = {
      id: "legacy",
      role: "assistant",
      parts: [
        {
          type: "tool-read_file",
          toolCallId: "call-1",
          state: "output-available",
          input: { path: "a.ts" },
          output: { content: "a" },
        },
      ],
    } as UIMessage;
    expect(getMessageRunStateLabel(message)).toBe("未完整结束");
  });

  it("uses persisted run outcomes", () => {
    const message = {
      id: "run",
      role: "assistant",
      parts: [{ type: "text", text: "question" }],
      metadata: { runSummary: { outcome: "awaiting-user" } },
    } as UIMessage;
    expect(getMessageRunStateLabel(message)).toBe("等待你的回复");
  });

  it("explains a persisted checkpoint failure", () => {
    const message = {
      id: "run-error",
      role: "assistant",
      parts: [{ type: "text", text: "partial" }],
      metadata: {
        runSummary: { outcome: "error", stopReason: "checkpoint-failed" },
      },
    } as UIMessage;
    expect(getMessageRunErrorLabel(message)).toBe("上下文检查点生成失败，运行已停止。");
  });
});

describe("run duration labels", () => {
  it("formats elapsed seconds", () => {
    expect(formatElapsedDuration(0)).toBe("0 秒");
    expect(formatElapsedDuration(12)).toBe("12 秒");
    expect(formatElapsedDuration(65)).toBe("1 分 5 秒");
    expect(formatElapsedDuration(120)).toBe("2 分");
  });

  it("shows persisted run duration on completed assistant messages", () => {
    expect(
      formatMessageRunDuration({
        id: "run",
        role: "assistant",
        parts: [{ type: "text", text: "done" }],
        metadata: { runSummary: { durationMs: 12_400 } },
      } as UIMessage),
    ).toBe("用时 12 秒");
  });

  it("uses a sub-second label for very short runs", () => {
    expect(
      formatMessageRunDuration({
        id: "run",
        role: "assistant",
        parts: [{ type: "text", text: "done" }],
        metadata: { runSummary: { durationMs: 480 } },
      } as UIMessage),
    ).toBe("用时不到 1 秒");
  });

  it("hides duration when metadata is missing", () => {
    expect(
      formatMessageRunDuration({
        id: "run",
        role: "assistant",
        parts: [{ type: "text", text: "done" }],
      } as UIMessage),
    ).toBeUndefined();
  });
});
