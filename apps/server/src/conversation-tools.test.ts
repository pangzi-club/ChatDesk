import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { createConversationTools } from "./conversation-tools.ts";
import type { ChatSession } from "./protocol.ts";
import { SessionStore } from "./store.ts";

function session(id: string, title: string, messages: ChatSession["messages"]): ChatSession {
  return {
    schemaVersion: 2,
    id,
    title,
    createdAt: "2026-08-20T00:00:00.000Z",
    updatedAt: "2026-08-20T01:00:00.000Z",
    messages,
    attachments: [],
  };
}

describe("conversation tools", () => {
  it("lists and searches visible conversation content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-conversation-tools-"));
    try {
      const store = new SessionStore(root);
      await store.init();
      await store.save(
        session("thread-one", "部署排查", [
          { id: "user-one", role: "user", parts: [{ type: "text", text: "检查部署" }] },
          {
            id: "assistant-one",
            role: "assistant",
            parts: [{ type: "text", text: "数据库连接超时" }],
          },
        ]),
      );
      const tools = createConversationTools(store);
      const search = (await tools.search_threads.execute?.(
        { searchTerm: "数据库连接超时", limit: 20 },
        {} as never,
      )) as { data: Array<{ thread: { id: string }; snippet: string }> };
      assert.equal(search.data[0]?.thread.id, "thread-one");
      assert.match(search.data[0]?.snippet ?? "", /数据库连接超时/);

      const list = (await tools.list_threads.execute?.({ limit: 20 }, {} as never)) as {
        data: Array<{ id: string; archived: boolean }>;
      };
      assert.equal(list.data[0]?.id, "thread-one");
      assert.equal(list.data[0]?.archived, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("locates occurrences and reads full turns", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-conversation-tools-"));
    try {
      const store = new SessionStore(root);
      await store.init();
      await store.save(
        session("thread-two", "超时", [
          {
            id: "user-two",
            role: "user",
            parts: [{ type: "text", text: "数据库连接超时怎么排查？" }],
          },
        ]),
      );
      const tools = createConversationTools(store);
      const occurrences = (await tools.search_thread_occurrences.execute?.(
        { threadId: "thread-two", searchTerm: "连接超时" },
        {} as never,
      )) as { data: Array<{ itemId: string; snippetMatchRange: { start: number; end: number } }> };
      assert.equal(occurrences.data[0]?.itemId, "user-two");
      assert.equal(occurrences.data[0]?.snippetMatchRange.start, 3);
      assert.equal(occurrences.data[0]?.snippetMatchRange.end, 7);

      const read = (await tools.read_thread.execute?.(
        { threadId: "thread-two", includeTurns: true },
        {} as never,
      )) as { thread: { turns: unknown[] } };
      assert.equal(read.thread.turns.length, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
