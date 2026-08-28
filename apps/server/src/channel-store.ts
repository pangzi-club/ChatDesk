import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ChannelContact,
  ChannelMessage,
  ChannelUnreadState,
  FeishuChannelConfig,
} from "@chatdesk/shared";

type Persisted = {
  configs: FeishuChannelConfig[];
  contacts: ChannelContact[];
  messages: ChannelMessage[];
  unread: ChannelUnreadState[];
};

const EMPTY: Persisted = { configs: [], contacts: [], messages: [], unread: [] };
const LEGACY_CHANNEL_ID = "legacy-feishu";

export class ChannelStore {
  private value: Persisted = EMPTY;
  private loaded = false;
  private readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "channels.json");
  }

  private async load() {
    if (this.loaded) return;
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<Persisted> & {
        config?: unknown;
      };
      const legacyConfig =
        parsed.config && typeof parsed.config === "object"
          ? {
              id: LEGACY_CHANNEL_ID,
              name:
                typeof (parsed.config as { name?: unknown }).name === "string" &&
                (parsed.config as { name: string }).name.trim()
                  ? (parsed.config as { name: string }).name.trim().slice(0, 80)
                  : "飞书",
              appId: String((parsed.config as { appId?: unknown }).appId ?? ""),
              appSecret: String((parsed.config as { appSecret?: unknown }).appSecret ?? ""),
              agentId: String((parsed.config as { agentId?: unknown }).agentId ?? ""),
            }
          : undefined;
      const configs = Array.isArray(parsed.configs)
        ? parsed.configs
        : legacyConfig
          ? [legacyConfig]
          : [];
      this.value = {
        configs: configs.filter((config): config is FeishuChannelConfig =>
          Boolean(
            config &&
              typeof config === "object" &&
              typeof config.id === "string" &&
              typeof config.name === "string" &&
              typeof config.appId === "string" &&
              typeof config.appSecret === "string" &&
              typeof config.agentId === "string",
          ),
        ),
        contacts: Array.isArray(parsed.contacts)
          ? parsed.contacts.map((contact) => ({
              ...contact,
              channelId: contact.channelId ?? (legacyConfig ? LEGACY_CHANNEL_ID : undefined),
              channelName: contact.channelName ?? legacyConfig?.name ?? "飞书",
            }))
          : [],
        messages: Array.isArray(parsed.messages)
          ? parsed.messages.map((message) => ({
              ...message,
              channelId: message.channelId ?? (legacyConfig ? LEGACY_CHANNEL_ID : undefined),
            }))
          : [],
        unread: Array.isArray(parsed.unread)
          ? parsed.unread.map((item) => ({
              ...item,
              channelId: item.channelId ?? (legacyConfig ? LEGACY_CHANNEL_ID : undefined),
            }))
          : [],
      };
    } catch {
      this.value = { ...EMPTY, contacts: [], messages: [], unread: [] };
    }
    this.loaded = true;
  }

  private async save() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temporary = `${this.file}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2), { mode: 0o600 });
    await rename(temporary, this.file);
  }

  async listConfigs() {
    await this.load();
    return [...this.value.configs];
  }
  async getConfig(channelId: string) {
    await this.load();
    return this.value.configs.find((config) => config.id === channelId);
  }
  async setConfig(config: FeishuChannelConfig) {
    await this.load();
    const index = this.value.configs.findIndex((item) => item.id === config.id);
    if (index >= 0) this.value.configs[index] = config;
    else this.value.configs.push(config);
    await this.save();
  }
  async deleteConfig(channelId: string) {
    await this.load();
    this.value.configs = this.value.configs.filter((config) => config.id !== channelId);
    await this.save();
  }
  async listContacts() {
    await this.load();
    return [...this.value.contacts].sort((a, b) =>
      (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
    );
  }
  async listMessages(channelId: string, contactId: string) {
    await this.load();
    return this.value.messages
      .filter((message) => message.channelId === channelId && message.contactId === contactId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async listUnread() {
    await this.load();
    return [...this.value.unread];
  }
  async getSessionId(channelId: string, contactId: string) {
    await this.load();
    return this.value.contacts.find((item) => item.channelId === channelId && item.id === contactId)
      ?.sessionId;
  }
  async setSessionId(channelId: string, contactId: string, sessionId: string) {
    await this.load();
    const contact = this.value.contacts.find(
      (item) => item.channelId === channelId && item.id === contactId,
    );
    if (contact) contact.sessionId = sessionId;
    await this.save();
  }
  async upsertMessage(message: ChannelMessage) {
    await this.load();
    if (
      this.value.messages.some(
        (item) => item.id === message.id && item.channelId === message.channelId,
      )
    )
      return false;
    this.value.messages.push(message);
    const contact = this.value.contacts.find(
      (item) => item.channelId === message.channelId && item.id === message.contactId,
    );
    if (contact) {
      Object.assign(contact, {
        ...(message.direction === "inbound"
          ? { name: message.senderName ?? message.contactId }
          : {}),
        ...(message.direction === "inbound" && message.senderAvatarUrl
          ? { avatarUrl: message.senderAvatarUrl }
          : {}),
        lastMessagePreview: message.text,
        lastMessageAt: message.createdAt,
      });
    } else
      this.value.contacts.push({
        id: message.contactId,
        channelId: message.channelId,
        channelName: (await this.getConfig(message.channelId))?.name ?? "飞书",
        provider: message.provider,
        name:
          message.direction === "inbound"
            ? (message.senderName ?? message.contactId)
            : message.contactId,
        ...(message.direction === "inbound" && message.senderAvatarUrl
          ? { avatarUrl: message.senderAvatarUrl }
          : {}),
        lastMessagePreview: message.text,
        lastMessageAt: message.createdAt,
        unreadCount: 0,
      });
    if (message.direction === "inbound") {
      const unread = this.value.unread.find(
        (item) => item.channelId === message.channelId && item.contactId === message.contactId,
      );
      if (unread) {
        unread.unreadCount += 1;
        unread.lastReceivedAt = message.createdAt;
      } else
        this.value.unread.push({
          contactId: message.contactId,
          channelId: message.channelId,
          unreadCount: 1,
          lastReceivedAt: message.createdAt,
        });
      const current = this.value.contacts.find(
        (item) => item.channelId === message.channelId && item.id === message.contactId,
      );
      if (current)
        current.unreadCount =
          this.value.unread.find(
            (item) => item.channelId === message.channelId && item.contactId === message.contactId,
          )?.unreadCount ?? 0;
    }
    await this.save();
    return true;
  }
  async markRead(channelId: string, contactId: string, messageId?: string) {
    await this.load();
    const unread = this.value.unread.find(
      (item) => item.channelId === channelId && item.contactId === contactId,
    );
    if (unread) {
      unread.unreadCount = 0;
      unread.lastReadMessageId = messageId;
    }
    const contact = this.value.contacts.find(
      (item) => item.channelId === channelId && item.id === contactId,
    );
    if (contact) contact.unreadCount = 0;
    await this.save();
  }
}
