import { isDesktop } from "@/lib/desktop-bridge";
import { settingsStore } from "@/lib/settings-store";

export type ShortcutAction =
  | "chatSidebar"
  | "chatSidebarMaximize"
  | "previousConversation"
  | "nextConversation";

export type ShortcutBinding = {
  alt: boolean;
  code?: string;
  ctrl: boolean;
  key: string;
  meta: boolean;
  shift: boolean;
};

export type ShortcutSettings = Record<ShortcutAction, ShortcutBinding>;

export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  chatSidebar: { alt: true, code: "KeyB", ctrl: false, key: "b", meta: true, shift: false },
  chatSidebarMaximize: {
    alt: true,
    code: "KeyM",
    ctrl: false,
    key: "m",
    meta: false,
    shift: false,
  },
  previousConversation: {
    alt: true,
    code: "ArrowUp",
    ctrl: false,
    key: "arrowup",
    meta: true,
    shift: false,
  },
  nextConversation: {
    alt: true,
    code: "ArrowDown",
    ctrl: false,
    key: "arrowdown",
    meta: true,
    shift: false,
  },
};

const SHORTCUTS_STORE_KEY = "shortcuts";
const SHORTCUTS_STORAGE_KEY = "m-dashboard-shortcuts-v1";
const SHORTCUTS_CHANGED_EVENT = "chatdesk-shortcuts-changed";

function isBinding(value: unknown): value is ShortcutBinding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Record<string, unknown>;
  return (
    typeof binding.key === "string" &&
    binding.key.length > 0 &&
    typeof binding.alt === "boolean" &&
    typeof binding.ctrl === "boolean" &&
    typeof binding.meta === "boolean" &&
    typeof binding.shift === "boolean"
  );
}

function normalizeBinding(value: unknown, fallback: ShortcutBinding): ShortcutBinding {
  if (!isBinding(value)) return fallback;
  return { ...value, code: value.code ?? keyToCode(value.key) };
}

function normalizeShortcuts(value: unknown): ShortcutSettings {
  if (!value || typeof value !== "object") return DEFAULT_SHORTCUTS;
  const record = value as Record<string, unknown>;
  const storedMaximize = isBinding(record.chatSidebarMaximize)
    ? record.chatSidebarMaximize
    : DEFAULT_SHORTCUTS.chatSidebarMaximize;
  const isLegacyMacosDefault =
    storedMaximize.alt &&
    storedMaximize.ctrl === false &&
    storedMaximize.key === "m" &&
    storedMaximize.meta &&
    !storedMaximize.code;
  return {
    chatSidebar: normalizeBinding(record.chatSidebar, DEFAULT_SHORTCUTS.chatSidebar),
    chatSidebarMaximize: isLegacyMacosDefault
      ? DEFAULT_SHORTCUTS.chatSidebarMaximize
      : normalizeBinding(record.chatSidebarMaximize, DEFAULT_SHORTCUTS.chatSidebarMaximize),
    previousConversation: normalizeBinding(
      record.previousConversation,
      DEFAULT_SHORTCUTS.previousConversation,
    ),
    nextConversation: normalizeBinding(record.nextConversation, DEFAULT_SHORTCUTS.nextConversation),
  };
}

function keyToCode(key: string) {
  return /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : undefined;
}

export async function loadShortcutSettings(): Promise<ShortcutSettings> {
  if (isDesktop()) {
    try {
      const stored = await settingsStore.get<unknown>(SHORTCUTS_STORE_KEY);
      if (stored) return normalizeShortcuts(stored);
    } catch (error) {
      console.error("Failed to load shortcut settings from desktop store", error);
    }
  }

  try {
    const raw = window.localStorage.getItem(SHORTCUTS_STORAGE_KEY);
    if (raw) return normalizeShortcuts(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to load shortcut settings from localStorage", error);
  }

  return DEFAULT_SHORTCUTS;
}

export async function saveShortcutSettings(settings: ShortcutSettings) {
  if (isDesktop()) {
    try {
      await settingsStore.set(SHORTCUTS_STORE_KEY, settings);
      await settingsStore.save();
      window.localStorage.removeItem(SHORTCUTS_STORAGE_KEY);
    } catch (error) {
      console.error("Failed to save shortcut settings to desktop store", error);
      window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(settings));
    }
  } else {
    window.localStorage.setItem(SHORTCUTS_STORAGE_KEY, JSON.stringify(settings));
  }
  window.dispatchEvent(new Event(SHORTCUTS_CHANGED_EVENT));
}

export function subscribeShortcutSettings(onChange: () => void) {
  window.addEventListener(SHORTCUTS_CHANGED_EVENT, onChange);
  return () => window.removeEventListener(SHORTCUTS_CHANGED_EVENT, onChange);
}

export function matchesShortcut(event: KeyboardEvent, binding: ShortcutBinding) {
  return (
    (binding.code
      ? event.code === binding.code
      : event.key.toLowerCase() === binding.key.toLowerCase()) &&
    event.altKey === binding.alt &&
    event.ctrlKey === binding.ctrl &&
    event.metaKey === binding.meta &&
    event.shiftKey === binding.shift
  );
}

function formatShortcutKey(binding: ShortcutBinding) {
  const code = binding.code ?? "";
  const key = binding.key.toLowerCase();
  if (code === "ArrowUp" || key === "arrowup") return "↑";
  if (code === "ArrowDown" || key === "arrowdown") return "↓";
  if (code.startsWith("Key")) return code.slice(3).toUpperCase();
  return binding.key.toUpperCase();
}

export function formatShortcut(binding: ShortcutBinding) {
  const modifiers = [
    binding.ctrl ? "⌃" : "",
    binding.alt ? "⌥" : "",
    binding.shift ? "⇧" : "",
    binding.meta ? "⌘" : "",
  ].join("");
  return `${modifiers}${formatShortcutKey(binding)}`;
}

export function shortcutFromKeyboardEvent(event: KeyboardEvent): ShortcutBinding | null {
  const isModifier = ["Alt", "Control", "Meta", "Shift"].includes(event.key);
  const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey;
  if (isModifier || !hasModifier || (!event.code && event.key.length !== 1)) {
    return null;
  }
  const key = event.code.startsWith("Key")
    ? event.code.slice(3).toLowerCase()
    : event.code.startsWith("Digit")
      ? event.code.slice(5)
      : event.key.toLowerCase();
  return {
    alt: event.altKey,
    code: event.code || keyToCode(event.key),
    ctrl: event.ctrlKey,
    key,
    meta: event.metaKey,
    shift: event.shiftKey,
  };
}
