import { describe, expect, it } from "vitest";
import { type ChatIndexItem, filterChatSearchResponse } from "./chat-store.ts";

function item(overrides: Partial<ChatIndexItem & { searchRelevance?: number }> = {}) {
  return {
    id: "session-1",
    title: "Recent chat",
    createdAt: "2026-08-19T00:00:00.000Z",
    updatedAt: "2026-08-19T00:00:00.000Z",
    messageCount: 1,
    attachmentCount: 0,
    ...overrides,
  };
}

describe("chat search response filtering", () => {
  it("does not show unfiltered recent chats while a keyword is present", () => {
    expect(filterChatSearchResponse([item()], "asia")).toEqual([]);
  });

  it("keeps marked search results and unfiltered recent chats in their respective modes", () => {
    const match = item({ searchRelevance: 5000 });
    expect(filterChatSearchResponse([match], "asia")).toEqual([match]);
    expect(filterChatSearchResponse([item()], "")).toEqual([item()]);
  });
});
