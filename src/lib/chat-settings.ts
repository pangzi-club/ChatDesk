import { settingsStore } from "@/lib/settings-store";

export type ChatFontSize = "large" | "default" | "small";
export type ChatSpacing = "loose" | "default" | "compact";

export type ChatDisplaySettings = {
  fontSize: ChatFontSize;
  spacing: ChatSpacing;
};

export const DEFAULT_CHAT_DISPLAY: ChatDisplaySettings = {
  fontSize: "default",
  spacing: "default",
};

const CHAT_DISPLAY_STORE_KEY = "chatDisplay";
const CHAT_DISPLAY_STORAGE_KEY = "m-dashboard-chat-display-v1";

function isChatFontSize(value: unknown): value is ChatFontSize {
  return value === "large" || value === "default" || value === "small";
}

function isChatSpacing(value: unknown): value is ChatSpacing {
  return value === "loose" || value === "default" || value === "compact";
}

function normalizeChatDisplay(value: unknown): ChatDisplaySettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_CHAT_DISPLAY;
  }

  const record = value as Record<string, unknown>;
  return {
    fontSize: isChatFontSize(record.fontSize) ? record.fontSize : DEFAULT_CHAT_DISPLAY.fontSize,
    spacing: isChatSpacing(record.spacing) ? record.spacing : DEFAULT_CHAT_DISPLAY.spacing,
  };
}

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadChatDisplaySettings(): Promise<ChatDisplaySettings> {
  if (isTauri()) {
    try {
      const stored = await settingsStore.get<unknown>(CHAT_DISPLAY_STORE_KEY);
      if (stored) {
        return normalizeChatDisplay(stored);
      }
    } catch (error) {
      console.error("Failed to load chat display settings from Tauri Store", error);
    }
  }

  try {
    const raw = window.localStorage.getItem(CHAT_DISPLAY_STORAGE_KEY);
    if (raw) {
      return normalizeChatDisplay(JSON.parse(raw));
    }
  } catch (error) {
    console.error("Failed to load chat display settings from localStorage", error);
  }

  return DEFAULT_CHAT_DISPLAY;
}

export async function saveChatDisplaySettings(settings: ChatDisplaySettings) {
  if (isTauri()) {
    try {
      await settingsStore.set(CHAT_DISPLAY_STORE_KEY, settings);
      await settingsStore.save();
      window.localStorage.removeItem(CHAT_DISPLAY_STORAGE_KEY);
      return;
    } catch (error) {
      console.error("Failed to save chat display settings to Tauri Store", error);
    }
  }

  window.localStorage.setItem(CHAT_DISPLAY_STORAGE_KEY, JSON.stringify(settings));
}
