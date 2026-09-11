import { describe, expect, it } from "vitest";
import {
  CHAT_USER_MESSAGE_COLLAPSE_CHARS,
  CHAT_USER_MESSAGE_COLLAPSE_LINES,
  CHAT_USER_MESSAGE_PREVIEW_CHARS,
  CHAT_USER_MESSAGE_PREVIEW_LINES,
  previewCollapsedChatUserMessage,
  shouldCollapseChatUserMessage,
} from "./chat-message-collapse";

describe("shouldCollapseChatUserMessage", () => {
  it("keeps short messages expanded", () => {
    expect(shouldCollapseChatUserMessage("总结下这份文档")).toBe(false);
  });

  it("collapses messages that exceed the line limit", () => {
    const text = Array.from(
      { length: CHAT_USER_MESSAGE_COLLAPSE_LINES + 1 },
      (_, index) => `line ${index + 1}`,
    ).join("\n");
    expect(shouldCollapseChatUserMessage(text)).toBe(true);
  });

  it("collapses messages that exceed the character limit", () => {
    expect(shouldCollapseChatUserMessage("字".repeat(CHAT_USER_MESSAGE_COLLAPSE_CHARS + 1))).toBe(
      true,
    );
  });
});

describe("previewCollapsedChatUserMessage", () => {
  it("keeps the first lines of a long paste", () => {
    const text = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join("\n");
    expect(previewCollapsedChatUserMessage(text)).toBe(
      Array.from(
        { length: CHAT_USER_MESSAGE_PREVIEW_LINES },
        (_, index) => `line ${index + 1}`,
      ).join("\n"),
    );
  });

  it("caps a single long line so the collapsed bubble stays short", () => {
    const preview = previewCollapsedChatUserMessage(
      "a".repeat(CHAT_USER_MESSAGE_PREVIEW_CHARS + 80),
    );
    expect(preview.length).toBe(CHAT_USER_MESSAGE_PREVIEW_CHARS);
    expect(preview.includes("\n")).toBe(false);
  });
});
