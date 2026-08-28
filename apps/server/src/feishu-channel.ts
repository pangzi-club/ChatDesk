import { randomUUID } from "node:crypto";
import type { EventHub } from "@chatdesk/agent-core";
import type {
  AgentConfig,
  ChannelMessage,
  FeishuChannelConfig,
  FeishuChannelStatus,
} from "@chatdesk/shared";
import { createLarkChannel, type LarkChannel } from "@larksuiteoapi/node-sdk";
import type { ChannelStore } from "./channel-store.ts";

export class FeishuChannelManager {
  private readonly store: ChannelStore;
  private readonly events: EventHub;
  private channel?: LarkChannel;
  private readonly queues = new Map<string, Promise<void>>();
  private readonly onMessage?: (item: ChannelMessage) => Promise<void>;
  private readonly getAgent?: (id: string) => AgentConfig | undefined;
  private readonly onProfileLookupError?: (message: string) => Promise<void>;
  private status: FeishuChannelStatus = {
    provider: "feishu",
    configured: false,
    status: "unconfigured",
  };
  constructor(
    store: ChannelStore,
    events: EventHub,
    onMessage?: (item: ChannelMessage) => Promise<void>,
    getAgent?: (id: string) => AgentConfig | undefined,
    onProfileLookupError?: (message: string) => Promise<void>,
  ) {
    this.store = store;
    this.events = events;
    this.onMessage = onMessage;
    this.getAgent = getAgent;
    this.onProfileLookupError = onProfileLookupError;
  }
  getStatus() {
    return this.status;
  }
  async start() {
    const config = await this.store.getConfig();
    if (config) await this.configure(config);
  }
  private statusFor(
    config: FeishuChannelConfig,
    status: FeishuChannelStatus["status"],
  ): FeishuChannelStatus {
    const agent = config.agentId ? this.getAgent?.(config.agentId) : undefined;
    return {
      provider: "feishu",
      configured: true,
      status,
      name: config.name || "飞书",
      appId: config.appId,
      agentId: config.agentId,
      agentName: agent?.name,
      agentAvatar: agent?.avatar,
      agentValid: Boolean(agent),
      needsAgent: !agent,
    };
  }
  async configure(config: FeishuChannelConfig) {
    await this.stop();
    const agent = config.agentId ? this.getAgent?.(config.agentId) : undefined;
    if (!agent) {
      this.status = {
        ...this.statusFor(config, "error"),
        lastError: "请为 Channel 绑定有效的 Agent",
      };
      this.publishStatus();
      return;
    }
    this.status = this.statusFor(config, "connecting");
    this.publishStatus();
    const channel = createLarkChannel({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: "https://open.feishu.cn",
      policy: { dmMode: "open", requireMention: false },
    });
    this.channel = channel;
    channel.on("message", async (message) => {
      if (message.chatType !== "p2p" || message.rawContentType !== "text") return;
      let senderName = message.senderName;
      let senderAvatarUrl: string | undefined;
      try {
        const response = await channel.rawClient.contact.user.get({
          path: { user_id: message.senderId },
          params: { user_id_type: "open_id" },
        });
        if (response.code !== undefined && response.code !== 0) {
          throw new Error(`code=${response.code}, msg=${response.msg ?? "未知错误"}`);
        }
        senderName = response.data?.user?.name || senderName;
        senderAvatarUrl = response.data?.user?.avatar?.avatar_72;
        if (!response.data?.user) {
          throw new Error("响应中没有 data.user");
        }
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        await this.onProfileLookupError?.(
          `联系人资料查询失败，senderId=${message.senderId}，${detail}；已回退使用联系人 ID`,
        );
      }
      const item: ChannelMessage = {
        id: message.messageId,
        provider: "feishu",
        contactId: message.senderId,
        senderId: message.senderId,
        senderName,
        senderAvatarUrl,
        text: message.content,
        direction: "inbound",
        status: "received",
        createdAt: new Date(message.createTime).toISOString(),
      };
      if (!(await this.store.upsertMessage(item))) return;
      const unread = await this.store.listUnread();
      this.events.publish({
        type: "channel.message.received",
        sessionId: "",
        channelProvider: "feishu",
        channelContactId: item.contactId,
        channelMessage: item,
        channelUnread: unread,
      });
      if (this.onMessage) {
        const previous = this.queues.get(item.contactId) ?? Promise.resolve();
        const next = previous
          .catch(() => undefined)
          .then(() => this.onMessage?.(item))
          .then(() => undefined);
        this.queues.set(item.contactId, next);
        void next.finally(() => {
          if (this.queues.get(item.contactId) === next) this.queues.delete(item.contactId);
        });
      }
      this.events.publish({
        type: "channel.unread.updated",
        sessionId: "",
        channelProvider: "feishu",
        channelUnread: unread,
      });
    });
    channel.on("reconnecting", () => {
      this.status = { ...this.status, status: "reconnecting" };
      this.publishStatus();
    });
    channel.on("reconnected", () => {
      this.status = {
        ...this.status,
        status: "connected",
        lastConnectedAt: new Date().toISOString(),
      };
      this.publishStatus();
    });
    channel.on("error", (error) => {
      this.status = { ...this.status, status: "error", lastError: error.message };
      this.publishStatus();
    });
    try {
      await channel.connect();
      this.status = {
        ...this.status,
        status: "connected",
        botName: channel.botIdentity?.name,
        lastConnectedAt: new Date().toISOString(),
      };
      this.publishStatus();
    } catch (error) {
      this.status = {
        ...this.status,
        status: "error",
        lastError: error instanceof Error ? error.message : String(error),
      };
      this.publishStatus();
    }
  }
  async stop() {
    if (this.channel) await this.channel.disconnect().catch(() => undefined);
    this.channel = undefined;
  }
  async saveConfig(config: FeishuChannelConfig) {
    await this.store.setConfig(config);
    await this.configure(config);
  }
  async clearConfig() {
    await this.store.setConfig(undefined);
    await this.stop();
    this.status = { provider: "feishu", configured: false, status: "unconfigured" };
    this.publishStatus();
  }
  async sendText(contactId: string, text: string) {
    if (!this.channel) throw new Error("飞书未连接");
    await this.channel.send(contactId, { text });
    const message: ChannelMessage = {
      id: `outbound-${randomUUID()}`,
      provider: "feishu",
      contactId,
      senderId: this.channel.botIdentity?.openId ?? "self",
      senderName: this.channel.botIdentity?.name,
      text,
      direction: "outbound",
      status: "sent",
      createdAt: new Date().toISOString(),
    };
    await this.store.upsertMessage(message);
    this.events.publish({
      type: "channel.message.received",
      sessionId: "",
      channelProvider: "feishu",
      channelContactId: contactId,
      channelMessage: message,
      channelUnread: await this.store.listUnread(),
    });
    return message;
  }
  private publishStatus() {
    this.events.publish({
      type: "channel.connection.status",
      sessionId: "",
      channelProvider: "feishu",
      channelStatus: this.status,
    });
  }
}
