import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  buildUserMessageNavItem,
  CHAT_MESSAGE_NAV_ATTACHMENT_TITLE,
  CHAT_MESSAGE_NAV_TITLE_CHARS,
  listUserMessageNavItems,
  resolveActiveUserMessageId,
} from "./chat-message-nav";

function userMessage(id: string, text: string, extraParts: UIMessage["parts"] = []): UIMessage {
  return {
    id,
    role: "user",
    parts: [{ type: "text", text }, ...extraParts],
  };
}

describe("buildUserMessageNavItem", () => {
  it("uses the first line as the title and the rest as the snippet", () => {
    expect(
      buildUserMessageNavItem(
        userMessage("m1", "hello\n你好，我还在继续看托盘图标的问题。现在重点核对打包配置。"),
      ),
    ).toEqual({
      id: "m1",
      title: "hello",
      snippet: "你好，我还在继续看托盘图标的问题。现在重点核对打包配置。",
    });
  });

  it("truncates a single long line for the title and keeps the full snippet", () => {
    const text = "字".repeat(CHAT_MESSAGE_NAV_TITLE_CHARS + 8);
    const item = buildUserMessageNavItem(userMessage("m2", text));
    expect(item.title).toBe(`${"字".repeat(CHAT_MESSAGE_NAV_TITLE_CHARS)}…`);
    expect(item.snippet).toBe(text);
  });

  it("falls back to the attachment label when there is no text", () => {
    expect(
      buildUserMessageNavItem({
        id: "file-1",
        parts: [{ type: "file", mediaType: "image/png", url: "https://example.com/a.png" }],
      }),
    ).toEqual({
      id: "file-1",
      title: CHAT_MESSAGE_NAV_ATTACHMENT_TITLE,
      snippet: "",
    });
  });
});

describe("listUserMessageNavItems", () => {
  it("keeps user turns and skips assistant messages", () => {
    const items = listUserMessageNavItems([
      userMessage("u1", "第一问"),
      { id: "a1", role: "assistant", parts: [{ type: "text", text: "回答" }] },
      userMessage("u2", "第二问"),
    ]);
    expect(items.map((item) => item.id)).toEqual(["u1", "u2"]);
  });

  it("keeps attachment-only user messages and skips empty ones", () => {
    const items = listUserMessageNavItems([
      {
        id: "empty",
        role: "user",
        parts: [{ type: "text", text: "   " }],
      },
      {
        id: "file-1",
        role: "user",
        parts: [{ type: "file", mediaType: "image/png", url: "https://example.com/a.png" }],
      },
    ]);
    expect(items).toEqual([
      { id: "file-1", title: CHAT_MESSAGE_NAV_ATTACHMENT_TITLE, snippet: "" },
    ]);
  });
});

describe("resolveActiveUserMessageId", () => {
  const items = [{ id: "u1" }, { id: "u2" }, { id: "u3" }];

  it("selects the last user message whose top has crossed the viewport", () => {
    const tops = { u1: 0, u2: 120, u3: 400 };
    expect(resolveActiveUserMessageId(items, (id) => tops[id as keyof typeof tops], 130)).toBe(
      "u2",
    );
  });

  it("falls back to the first item when every message is below the viewport", () => {
    const tops = { u1: 80, u2: 160, u3: 240 };
    expect(resolveActiveUserMessageId(items, (id) => tops[id as keyof typeof tops], 0)).toBe("u1");
  });
});
