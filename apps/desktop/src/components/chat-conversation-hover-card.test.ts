import { describe, expect, it } from "vitest";
import { formatConversationCreatedAt } from "./chat-conversation-hover-card";

describe("formatConversationCreatedAt", () => {
  const now = Date.parse("2026-08-19T12:20:00.000Z");

  it("formats timestamps as compact relative durations", () => {
    expect(formatConversationCreatedAt("2026-08-19T12:19:30.000Z", now)).toBe("刚刚");
    expect(formatConversationCreatedAt("2026-08-19T11:19:00.000Z", now)).toBe("1h");
    expect(formatConversationCreatedAt("2026-08-17T12:20:00.000Z", now)).toBe("2d");
    expect(formatConversationCreatedAt("2026-08-12T12:20:00.000Z", now)).toBe("7d");
    expect(formatConversationCreatedAt("2026-07-19T12:20:00.000Z", now)).toBe("1mo");
  });

  it("falls back for invalid timestamps", () => {
    expect(formatConversationCreatedAt("invalid")).toBe("未知时间");
  });
});
