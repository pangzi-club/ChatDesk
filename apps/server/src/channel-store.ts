import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ChannelContact,
  ChannelMessage,
  ChannelUnreadState,
  FeishuChannelConfig,
} from "@chatdesk/shared";

type Persisted = {
  config?: FeishuChannelConfig;
  contacts: ChannelContact[];
  messages: ChannelMessage[];
  unread: ChannelUnreadState[];
};

const EMPTY: Persisted = { contacts: [], messages: [], unread: [] };

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
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as Partial<Persisted>;
      this.value = {
        config:
          parsed.config && typeof parsed.config === "object"
            ? {
                name: (() => {
                  const name = (parsed.config as Partial<FeishuChannelConfig>).name;
                  return typeof name === "string" && name.trim()
                    ? name.trim().slice(0, 80)
                    : "飞书";
                })(),
                appId: String((parsed.config as Partial<FeishuChannelConfig>).appId ?? ""),
                appSecret: String((parsed.config as Partial<FeishuChannelConfig>).appSecret ?? ""),
                agentId: String((parsed.config as Partial<FeishuChannelConfig>).agentId ?? ""),
              }
            : undefined,
        contacts: Array.isArray(parsed.contacts) ? parsed.contacts : [],
        messages: Array.isArray(parsed.messages) ? parsed.messages : [],
        unread: Array.isArray(parsed.unread) ? parsed.unread : [],
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

  async getConfig() {
    await this.load();
    return this.value.config;
  }
  async setConfig(config: FeishuChannelConfig | undefined) {
    await this.load();
    this.value.config = config;
    await this.save();
  }
  async listContacts() {
    await this.load();
    return [...this.value.contacts].sort((a, b) =>
      (b.lastMessageAt ?? "").localeCompare(a.lastMessageAt ?? ""),
    );
  }
  async listMessages(contactId: string) {
    await this.load();
    return this.value.messages
      .filter((message) => message.contactId === contactId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async listUnread() {
    await this.load();
    return [...this.value.unread];
  }
  async getSessionId(contactId: string) {
    await this.load();
    return this.value.contacts.find((item) => item.id === contactId)?.sessionId;
  }
  async setSessionId(contactId: string, sessionId: string) {
    await this.load();
    const contact = this.value.contacts.find((item) => item.id === contactId);
    if (contact) contact.sessionId = sessionId;
    await this.save();
  }
  async upsertMessage(message: ChannelMessage) {
    await this.load();
    if (this.value.messages.some((item) => item.id === message.id)) return false;
    this.value.messages.push(message);
    const contact = this.value.contacts.find((item) => item.id === message.contactId);
    if (contact)
      Object.assign(contact, {
        ...(message.senderName && contact.name === contact.id ? { name: message.senderName } : {}),
        lastMessagePreview: message.text,
        lastMessageAt: message.createdAt,
      });
    else
      this.value.contacts.push({
        id: message.contactId,
        provider: message.provider,
        name: message.senderName ?? message.contactId,
        lastMessagePreview: message.text,
        lastMessageAt: message.createdAt,
        unreadCount: 0,
      });
    if (message.direction === "inbound") {
      const unread = this.value.unread.find((item) => item.contactId === message.contactId);
      if (unread) {
        unread.unreadCount += 1;
        unread.lastReceivedAt = message.createdAt;
      } else
        this.value.unread.push({
          contactId: message.contactId,
          unreadCount: 1,
          lastReceivedAt: message.createdAt,
        });
      const current = this.value.contacts.find((item) => item.id === message.contactId);
      if (current)
        current.unreadCount =
          this.value.unread.find((item) => item.contactId === message.contactId)?.unreadCount ?? 0;
    }
    await this.save();
    return true;
  }
  async markRead(contactId: string, messageId?: string) {
    await this.load();
    const unread = this.value.unread.find((item) => item.contactId === contactId);
    if (unread) {
      unread.unreadCount = 0;
      unread.lastReadMessageId = messageId;
    }
    const contact = this.value.contacts.find((item) => item.id === contactId);
    if (contact) contact.unreadCount = 0;
    await this.save();
  }
}
