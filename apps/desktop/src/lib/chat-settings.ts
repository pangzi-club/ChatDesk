import type { ChatLayout } from "@/lib/chat-layout";
import { isDesktop } from "@/lib/desktop-bridge";
import { settingsStore } from "@/lib/settings-store";

export type { ChatLayout } from "@/lib/chat-layout";

export type ChatDisplaySettings = { layout: ChatLayout };

export const DEFAULT_CHAT_DISPLAY: ChatDisplaySettings = { layout: "standard" };

const CHAT_DISPLAY_STORE_KEY = "chatDisplay";
const CHAT_DISPLAY_STORAGE_KEY = "m-dashboard-chat-display-v1";

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

export async function loadChatDisplaySettings(): Promise<ChatDisplaySettings> {
  if (isDesktop()) {
    try {
      const stored = await settingsStore.get<unknown>(CHAT_DISPLAY_STORE_KEY);
      if (stored) return normalizeChatDisplay(stored);
    } catch (error) {
      console.error("Failed to load chat display settings from desktop store", error);
    }
  }
  try {
    const raw = window.localStorage.getItem(CHAT_DISPLAY_STORAGE_KEY);
    if (raw) return normalizeChatDisplay(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to load chat display settings from localStorage", error);
  }
  return DEFAULT_CHAT_DISPLAY;
}

export async function saveChatDisplaySettings(settings: ChatDisplaySettings) {
  if (isDesktop()) {
    try {
      await settingsStore.set(CHAT_DISPLAY_STORE_KEY, settings);
      await settingsStore.save();
      window.localStorage.removeItem(CHAT_DISPLAY_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent("chat-display-settings-change", { detail: settings }));
      return;
    } catch (error) {
      console.error("Failed to save chat display settings to desktop store", error);
    }
  }
  window.localStorage.setItem(CHAT_DISPLAY_STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent("chat-display-settings-change", { detail: settings }));
}
