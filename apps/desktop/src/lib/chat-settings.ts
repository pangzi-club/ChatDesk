import { isDesktop } from "@/lib/desktop-bridge";
import { settingsStore } from "@/lib/settings-store";

export type ChatFontSize = "large" | "default" | "small";
export type ChatSpacing = "loose" | "default" | "compact";
export type ChatBodyFont =
  | "system"
  | "pingfang"
  | "hiragino"
  | "segoe"
  | "noto"
  | "inter"
  | "serif";
export type ChatCodeFont = "system" | "sf-mono" | "menlo" | "cascadia" | "consolas" | "courier";
export type ChatMathFont = "katex" | "cambria" | "stix" | "times";

export type ChatDisplaySettings = {
  fontSize: ChatFontSize;
  spacing: ChatSpacing;
  showTokenUsage: boolean;
  bodyFont: ChatBodyFont;
  codeFont: ChatCodeFont;
  mathFont: ChatMathFont;
};

export const DEFAULT_CHAT_DISPLAY: ChatDisplaySettings = {
  fontSize: "default",
  spacing: "default",
  showTokenUsage: true,
  bodyFont: "system",
  codeFont: "system",
  mathFont: "katex",
};

const CHAT_DISPLAY_STORE_KEY = "chatDisplay";
const CHAT_DISPLAY_STORAGE_KEY = "m-dashboard-chat-display-v1";

function isChatFontSize(value: unknown): value is ChatFontSize {
  return value === "large" || value === "default" || value === "small";
}

function isChatSpacing(value: unknown): value is ChatSpacing {
  return value === "loose" || value === "default" || value === "compact";
}

function isChatBodyFont(value: unknown): value is ChatBodyFont {
  return (
    value === "system" ||
    value === "pingfang" ||
    value === "hiragino" ||
    value === "segoe" ||
    value === "noto" ||
    value === "inter" ||
    value === "serif"
  );
}

function isChatCodeFont(value: unknown): value is ChatCodeFont {
  return (
    value === "system" ||
    value === "sf-mono" ||
    value === "menlo" ||
    value === "cascadia" ||
    value === "consolas" ||
    value === "courier"
  );
}

function isChatMathFont(value: unknown): value is ChatMathFont {
  return value === "katex" || value === "cambria" || value === "stix" || value === "times";
}

function normalizeLegacyBodyFont(value: unknown): unknown {
  if (value === "apple") return "pingfang";
  if (value === "windows") return "segoe";
  return value;
}

function normalizeLegacyCodeFont(value: unknown): unknown {
  if (value === "apple") return "sf-mono";
  if (value === "windows") return "cascadia";
  return value;
}

function normalizeLegacyMathFont(value: unknown): unknown {
  if (value === "system") return "cambria";
  return value;
}

function normalizeChatDisplay(value: unknown): ChatDisplaySettings {
  if (!value || typeof value !== "object") {
    return DEFAULT_CHAT_DISPLAY;
  }

  const record = value as Record<string, unknown>;
  return {
    fontSize: isChatFontSize(record.fontSize) ? record.fontSize : DEFAULT_CHAT_DISPLAY.fontSize,
    spacing: isChatSpacing(record.spacing) ? record.spacing : DEFAULT_CHAT_DISPLAY.spacing,
    showTokenUsage:
      typeof record.showTokenUsage === "boolean"
        ? record.showTokenUsage
        : DEFAULT_CHAT_DISPLAY.showTokenUsage,
    bodyFont: isChatBodyFont(normalizeLegacyBodyFont(record.bodyFont))
      ? (normalizeLegacyBodyFont(record.bodyFont) as ChatBodyFont)
      : DEFAULT_CHAT_DISPLAY.bodyFont,
    codeFont: isChatCodeFont(normalizeLegacyCodeFont(record.codeFont))
      ? (normalizeLegacyCodeFont(record.codeFont) as ChatCodeFont)
      : DEFAULT_CHAT_DISPLAY.codeFont,
    mathFont: isChatMathFont(normalizeLegacyMathFont(record.mathFont))
      ? (normalizeLegacyMathFont(record.mathFont) as ChatMathFont)
      : DEFAULT_CHAT_DISPLAY.mathFont,
  };
}

export async function loadChatDisplaySettings(): Promise<ChatDisplaySettings> {
  if (isDesktop()) {
    try {
      const stored = await settingsStore.get<unknown>(CHAT_DISPLAY_STORE_KEY);
      if (stored) {
        return normalizeChatDisplay(stored);
      }
    } catch (error) {
      console.error("Failed to load chat display settings from desktop store", error);
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
