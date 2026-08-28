import { mkdtemp, readFile } from "node:fs/promises";
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
});
