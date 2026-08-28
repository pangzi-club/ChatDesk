import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ChannelStore } from "./channel-store.ts";

describe("ChannelStore", () => {
  it("does not use an outbound bot name as the contact name", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "chatdesk-channel-store-"));
    const store = new ChannelStore(dataDir);

    await store.upsertMessage({
      id: "outbound-1",
      channelId: "bot-a",
      provider: "feishu",
      contactId: "ou-contact",
      senderId: "ou-bot",
      senderName: "Bot-MacbookPro",
      text: "hello",
      direction: "outbound",
      status: "sent",
      createdAt: "2026-08-28T00:00:00.000Z",
    });

    expect((await store.listContacts())[0]?.name).toBe("ou-contact");
    expect(
      JSON.parse(await readFile(path.join(dataDir, "channels.json"), "utf8")).contacts[0].name,
    ).toBe("ou-contact");
  });

  it("isolates the same contact across bots", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "chatdesk-channel-store-"));
    const store = new ChannelStore(dataDir);
    await store.setConfig({
      id: "bot-a",
      name: "客服",
      appId: "a",
      appSecret: "secret",
      agentId: "agent",
    });
    await store.setConfig({
      id: "bot-b",
      name: "销售",
      appId: "b",
      appSecret: "secret",
      agentId: "agent",
    });
    for (const [channelId, messageId] of [
      ["bot-a", "a-1"],
      ["bot-b", "b-1"],
    ]) {
      await store.upsertMessage({
        id: messageId,
        channelId,
        provider: "feishu",
        contactId: "ou-same",
        senderId: "ou-same",
        senderName: "同一联系人",
        text: channelId,
        direction: "inbound",
        status: "received",
        createdAt: "2026-08-28T00:00:00.000Z",
      });
    }
    const contacts = await store.listContacts();
    expect(contacts).toHaveLength(2);
    expect(contacts.map((item) => item.channelName).sort()).toEqual(["客服", "销售"]);
    await store.setSessionId("bot-a", "ou-same", "session-a");
    expect(await store.getSessionId("bot-a", "ou-same")).toBe("session-a");
    expect(await store.getSessionId("bot-b", "ou-same")).toBeUndefined();
    await store.markRead("bot-a", "ou-same");
    expect((await store.listUnread()).find((item) => item.channelId === "bot-a")?.unreadCount).toBe(
      0,
    );
    expect((await store.listUnread()).find((item) => item.channelId === "bot-b")?.unreadCount).toBe(
      1,
    );
  });

  it("keeps legacy single-channel data visible until it is updated", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "chatdesk-channel-store-"));
    await writeFile(
      path.join(dataDir, "channels.json"),
      JSON.stringify({
        config: {
          name: "旧飞书",
          appId: "legacy-app",
          appSecret: "legacy-secret",
          agentId: "legacy-agent",
        },
        contacts: [],
        messages: [],
        unread: [],
      }),
    );
    const store = new ChannelStore(dataDir);
    expect(await store.listConfigs()).toEqual([
      {
        id: "legacy-feishu",
        name: "旧飞书",
        appId: "legacy-app",
        appSecret: "legacy-secret",
        agentId: "legacy-agent",
      },
    ]);
  });
});
