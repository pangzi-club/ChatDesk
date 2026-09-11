import type { ChatLayout } from "@/lib/plugins/chat-layout";
import { createSettingsAdapter } from "@/lib/settings/create-settings-adapter";

export type { ChatLayout } from "@/lib/plugins/chat-layout";

export type ChatDisplaySettings = { layout: ChatLayout };

export const DEFAULT_CHAT_DISPLAY: ChatDisplaySettings = { layout: "standard" };

const CHAT_DISPLAY_STORAGE_KEY = "chatdesk-chat-display-v1";
const CHAT_DISPLAY_LEGACY_STORAGE_KEY = "m-dashboard-chat-display-v1";

function isChatLayout(value: unknown): value is ChatLayout {
  return value === "standard" || value === "cute" || value === "geek";
}

export function normalizeChatDisplay(value: unknown): ChatDisplaySettings {
  if (!value || typeof value !== "object") return DEFAULT_CHAT_DISPLAY;
  const record = value as Record<string, unknown>;
  if (isChatLayout(record.layout)) return { layout: record.layout };
  if (record.fontSize === "small" || record.spacing === "compact") return { layout: "geek" };
  if (record.fontSize === "large" || record.spacing === "loose") return { layout: "cute" };
  return DEFAULT_CHAT_DISPLAY;
}

const CHAT_DISPLAY_ADAPTER = createSettingsAdapter<ChatDisplaySettings>({
  storeKey: "chatDisplay",
  storageKey: CHAT_DISPLAY_STORAGE_KEY,
  legacyStorageKeys: [CHAT_DISPLAY_LEGACY_STORAGE_KEY],
  eventName: "chat-display-settings-change",
  normalize: normalizeChatDisplay,
  defaultValue: DEFAULT_CHAT_DISPLAY,
  label: "chat display settings",
});

export function loadChatDisplaySettings(): Promise<ChatDisplaySettings> {
  return CHAT_DISPLAY_ADAPTER.load();
}

export function saveChatDisplaySettings(settings: ChatDisplaySettings): Promise<void> {
  return CHAT_DISPLAY_ADAPTER.save(settings);
}
