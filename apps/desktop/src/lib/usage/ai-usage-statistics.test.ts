import { describe, expect, it } from "vitest";
import { removeMessageAggregatesCoveredByCallLogs, type UsageRecord } from "./ai-usage-statistics";

function record(source: UsageRecord["source"], authorityKey?: string): UsageRecord {
  return {
    date: "2026-08-15",
    source,
    provider: "provider",
    model: "model",
    usage: { inputTokens: 10 },
    messageCount: 1,
    authorityKey,
  };
}

describe("AI usage authority", () => {
  it("uses per-call logs for new runs and preserves legacy message usage", () => {
    const records = [
      record("native", "session-1:run-1"),
      record("native"),
      record("codex", "session-1:run-1"),
    ];
    expect(
      removeMessageAggregatesCoveredByCallLogs(records, [
        { sessionId: "session-1", runId: "run-1" },
      ]),
    ).toEqual([records[1], records[2]]);
  });
});
