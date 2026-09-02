import { describe, expect, it } from "vitest";
import { normalizeChatDisplay } from "@/lib/chat-settings";

describe("chat layout settings", () => {
  it("accepts the three persisted layouts", () => {
    expect(normalizeChatDisplay({ layout: "cute" })).toEqual({ layout: "cute" });
    expect(normalizeChatDisplay({ layout: "geek" })).toEqual({ layout: "geek" });
  });

  it("migrates legacy density preferences", () => {
    expect(normalizeChatDisplay({ fontSize: "small" })).toEqual({ layout: "geek" });
    expect(normalizeChatDisplay({ spacing: "compact" })).toEqual({ layout: "geek" });
    expect(normalizeChatDisplay({ fontSize: "large" })).toEqual({ layout: "cute" });
    expect(normalizeChatDisplay({ spacing: "loose" })).toEqual({ layout: "cute" });
    expect(normalizeChatDisplay({ fontSize: "default", spacing: "default" })).toEqual({
      layout: "standard",
    });
  });

  it("falls back to standard for invalid values", () => {
    expect(normalizeChatDisplay({ layout: "unknown" })).toEqual({ layout: "standard" });
    expect(normalizeChatDisplay(null)).toEqual({ layout: "standard" });
  });
});
