import { randomUUID } from "node:crypto";
import type { EventHub } from "@chatdesk/agent-core";
import type { ChannelMessage, FeishuChannelStatus } from "@chatdesk/shared";
import { createLarkChannel, type LarkChannel } from "@larksuiteoapi/node-sdk";
import type { ChannelStore } from "./channel-store.ts";

export class FeishuChannelManager {
  private readonly store: ChannelStore;
  private readonly events: EventHub;
  private channel?: LarkChannel;
  private status: FeishuChannelStatus = {
    provider: "feishu",
    configured: false,
    status: "unconfigured",
  };
  constructor(store: ChannelStore, events: EventHub) {
    this.store = store;
    this.events = events;
  }
  getStatus() {
    return this.status;
  }
  async start() {
    const config = await this.store.getConfig();
    if (config) await this.configure(config);
  }
  async configure(config: { appId: string; appSecret: string }) {
    await this.stop();
    this.status = {
      provider: "feishu",
      configured: true,
      status: "connecting",
      appId: config.appId,
    };
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
      if (!senderName) {
        try {
          const response = await channel.rawClient.contact.user.get({
            path: { user_id: message.senderId },
            params: { user_id_type: "open_id" },
          });
          senderName = response.data?.user?.name;
        } catch {
          // The message remains usable when the app lacks contact read permission.
        }
      }
      const item: ChannelMessage = {
        id: message.messageId,
        provider: "feishu",
        contactId: message.senderId,
        senderId: message.senderId,
        senderName,
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
  async saveConfig(config: { appId: string; appSecret: string }) {
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
