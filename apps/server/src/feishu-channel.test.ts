import assert from "node:assert/strict";
import type { AgentConfig, ChannelMessage } from "@chatdesk/shared";
import { beforeEach, describe, it, vi } from "vitest";
import { FeishuChannelManager } from "./feishu-channel.ts";

const { createLarkChannelMock } = vi.hoisted(() => ({
  createLarkChannelMock: vi.fn(),
}));

vi.mock("@larksuiteoapi/node-sdk", () => ({
  createLarkChannel: createLarkChannelMock,
}));

function testAgent(): AgentConfig {
  return {
    id: "agent-1",
    name: "Test Agent",
    avatar: "",
    modelId: "model-1",
    systemPrompt: "",
    toolPackIds: [],
    mcpServerIds: [],
    skillIds: [],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("FeishuChannelManager outbound messages", () => {
  beforeEach(() => {
    createLarkChannelMock.mockReset();
  });

  it("sends Markdown and persists the original Markdown text", async () => {
    const sends: unknown[][] = [];
    const saved: ChannelMessage[] = [];
    const published: unknown[] = [];
    createLarkChannelMock.mockReturnValue({
      botIdentity: { openId: "bot-1", name: "Bot" },
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send: vi.fn(async (...args: unknown[]) => {
        sends.push(args);
        return { messageId: "message-1" };
      }),
    });
    const store = {
      upsertMessage: vi.fn(async (message: ChannelMessage) => {
        saved.push(message);
        return true;
      }),
      listUnread: vi.fn(async () => []),
    };
    const events = { publish: vi.fn((event: unknown) => published.push(event)) };
    const manager = new FeishuChannelManager(
      "channel-1",
      store as never,
      events as never,
      undefined,
      () => testAgent(),
    );

    await manager.configure({
      id: "channel-1",
      name: "Test",
      appId: "app-1",
      appSecret: "secret",
      agentId: "agent-1",
    });
    const markdown = "# 标题\n\n**加粗**\n\n```ts\nconst answer = 42;\n```";
    const message = await manager.sendMarkdown("contact-1", markdown);

    assert.deepEqual(sends, [["contact-1", { markdown }]]);
    assert.equal(saved[0]?.text, markdown);
    assert.equal(saved[0]?.direction, "outbound");
    const outboundEvent = published.find((event) =>
      Boolean((event as { channelMessage?: ChannelMessage }).channelMessage),
    ) as { channelMessage: ChannelMessage };
    assert.equal(outboundEvent.channelMessage.text, markdown);
    assert.equal(message.text, markdown);
  });

  it("keeps manual text messages as plain text", async () => {
    const send = vi.fn().mockResolvedValue({ messageId: "message-1" });
    createLarkChannelMock.mockReturnValue({
      botIdentity: { openId: "bot-1", name: "Bot" },
      on: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send,
    });
    const store = {
      upsertMessage: vi.fn().mockResolvedValue(true),
      listUnread: vi.fn().mockResolvedValue([]),
    };
    const events = { publish: vi.fn() };
    const manager = new FeishuChannelManager(
      "channel-1",
      store as never,
      events as never,
      undefined,
      () => testAgent(),
    );
    await manager.configure({
      id: "channel-1",
      name: "Test",
      appId: "app-1",
      appSecret: "secret",
      agentId: "agent-1",
    });

    await manager.sendText("contact-1", "**仍是纯文本**");

    assert.deepEqual(send.mock.calls, [["contact-1", { text: "**仍是纯文本**" }]]);
  });

  it("replies with the unsupported-input notice for inbound audio", async () => {
    let onMessage: ((message: unknown) => Promise<void>) | undefined;
    const send = vi.fn().mockResolvedValue({ messageId: "message-1" });
    createLarkChannelMock.mockReturnValue({
      botIdentity: { openId: "bot-1", name: "Bot" },
      on: vi.fn((event: string, handler: (message: unknown) => Promise<void>) => {
        if (event === "message") onMessage = handler;
      }),
      rawClient: {
        contact: {
          user: {
            get: vi.fn().mockResolvedValue({
              code: 0,
              data: { user: { name: "Alice", avatar: { avatar_72: "" } } },
            }),
          },
        },
      },
      connect: vi.fn().mockResolvedValue(undefined),
      disconnect: vi.fn().mockResolvedValue(undefined),
      send,
    });
    const saved: ChannelMessage[] = [];
    const store = {
      listContacts: vi.fn().mockResolvedValue([]),
      upsertMessage: vi.fn(async (message: ChannelMessage) => {
        saved.push(message);
        return true;
      }),
      listUnread: vi.fn().mockResolvedValue([]),
    };
    const manager = new FeishuChannelManager(
      "channel-1",
      store as never,
      { publish: vi.fn() } as never,
      undefined,
      () => testAgent(),
    );

    await manager.configure({
      id: "channel-1",
      name: "Test",
      appId: "app-1",
      appSecret: "secret",
      agentId: "agent-1",
    });
    await onMessage?.({
      messageId: "audio-1",
      chatType: "p2p",
      rawContentType: "audio",
      senderId: "contact-1",
      senderName: "Alice",
      content: '{"file_key":"file-1","duration":1000}',
      createTime: Date.now(),
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assert.equal(saved[0]?.text, "语音消息");
    assert.deepEqual(send.mock.calls, [["contact-1", { text: "当前环境暂不支持语音输入" }]]);
  });
});
