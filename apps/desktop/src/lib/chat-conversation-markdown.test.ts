import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  canFormatChatConversationMarkdown,
  formatChatConversationMarkdown,
} from "./chat-conversation-markdown";

function message(role: UIMessage["role"], parts: UIMessage["parts"], id = role): UIMessage {
  return { id, role, parts };
}

describe("formatChatConversationMarkdown", () => {
  it("renders the title and user/assistant turns as markdown", () => {
    expect(
      formatChatConversationMarkdown({
        title: "修复登录",
        messages: [
          message("user", [{ type: "text", text: "帮我看一下登录页" }]),
          message("assistant", [{ type: "text", text: "先检查路由。\n\n再核对表单校验。" }]),
        ],
      }),
    ).toBe(`# 修复登录

## 用户

帮我看一下登录页

## 助手

先检查路由。

再核对表单校验。`);
  });

  it("skips empty, system, and tool-only messages", () => {
    expect(
      formatChatConversationMarkdown({
        title: "  草稿 会话  ",
        messages: [
          message("system", [{ type: "text", text: "hidden" }]),
          message("user", [{ type: "text", text: "   " }]),
          message("assistant", [
            {
              type: "dynamic-tool",
              toolCallId: "tool-1",
              toolName: "web_search",
              state: "output-available",
              input: {},
              output: {},
            },
          ]),
          message("user", [{ type: "text", text: "继续" }]),
        ],
      }),
    ).toBe(`# 草稿 会话

## 用户

继续`);
  });

  it("uses a fallback title when the session name is blank", () => {
    expect(formatChatConversationMarkdown({ title: "   ", messages: [] })).toBe("# 未命名对话");
  });
});

describe("canFormatChatConversationMarkdown", () => {
  it("requires at least one visible user or assistant text part", () => {
    expect(canFormatChatConversationMarkdown([])).toBe(false);
    expect(
      canFormatChatConversationMarkdown([message("assistant", [{ type: "text", text: "  " }])]),
    ).toBe(false);
    expect(
      canFormatChatConversationMarkdown([message("user", [{ type: "text", text: "你好" }])]),
    ).toBe(true);
  });
});
