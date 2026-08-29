import { describe, expect, it } from "vitest";
import {
  CHANNEL_SESSION_IDLE_MS,
  isChannelSessionIdle,
  parseChannelCommand,
  parseClearCommand,
} from "./channel-session.ts";

describe("channel session boundaries", () => {
  it("parses local channel commands without matching normal text", () => {
    expect(parseChannelCommand("/help")).toBe("help");
    expect(parseChannelCommand("/status")).toBe("status");
    expect(parseChannelCommand("/stauts")).toBe("status");
    expect(parseChannelCommand("请查看 /status")).toBeUndefined();
  });

  it("parses clear commands only at the beginning of a message", () => {
    expect(parseClearCommand(" /clear 新问题 ")).toEqual({ remainder: "新问题" });
    expect(parseClearCommand("/clear")).toEqual({ remainder: "" });
    expect(parseClearCommand("请执行 /clear")).toBeUndefined();
  });

  it("starts a new session after one hour of inactivity", () => {
    const now = Date.parse("2026-08-29T01:00:00.000Z");
    expect(isChannelSessionIdle(new Date(now - CHANNEL_SESSION_IDLE_MS).toISOString(), now)).toBe(
      true,
    );
    expect(
      isChannelSessionIdle(new Date(now - CHANNEL_SESSION_IDLE_MS + 1).toISOString(), now),
    ).toBe(false);
    expect(isChannelSessionIdle(undefined, now)).toBe(false);
  });
});
