import { describe, expect, it } from "vitest";
import { getMessageContextUsage } from "@/lib/chat-usage";

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
