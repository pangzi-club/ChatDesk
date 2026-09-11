import { createSettingsAdapter } from "@/lib/settings/create-settings-adapter";

export type ShortcutAction =
  | "mainSidebar"
  | "chatSidebar"
  | "chatSidebarMaximize"
  | "newConversation"
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
  mainSidebar: { alt: false, code: "KeyB", ctrl: false, key: "b", meta: true, shift: false },
  chatSidebar: { alt: true, code: "KeyB", ctrl: false, key: "b", meta: true, shift: false },
  chatSidebarMaximize: {
    alt: true,
    code: "KeyM",
    ctrl: false,
    key: "m",
    meta: false,
    shift: false,
  },
  newConversation: {
    alt: false,
    code: "KeyN",
    ctrl: false,
    key: "n",
    meta: true,
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

const SHORTCUTS_STORAGE_KEY = "chatdesk-shortcuts-v1";
const SHORTCUTS_LEGACY_STORAGE_KEY = "m-dashboard-shortcuts-v1";
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

export function normalizeShortcuts(value: unknown): ShortcutSettings {
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
    mainSidebar: normalizeBinding(record.mainSidebar, DEFAULT_SHORTCUTS.mainSidebar),
    chatSidebar: normalizeBinding(record.chatSidebar, DEFAULT_SHORTCUTS.chatSidebar),
    chatSidebarMaximize: isLegacyMacosDefault
      ? DEFAULT_SHORTCUTS.chatSidebarMaximize
      : normalizeBinding(record.chatSidebarMaximize, DEFAULT_SHORTCUTS.chatSidebarMaximize),
    newConversation: normalizeBinding(record.newConversation, DEFAULT_SHORTCUTS.newConversation),
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

const SHORTCUTS_ADAPTER = createSettingsAdapter<ShortcutSettings>({
  storeKey: "shortcuts",
  storageKey: SHORTCUTS_STORAGE_KEY,
  legacyStorageKeys: [SHORTCUTS_LEGACY_STORAGE_KEY],
  eventName: SHORTCUTS_CHANGED_EVENT,
  normalize: normalizeShortcuts,
  defaultValue: DEFAULT_SHORTCUTS,
  label: "shortcut settings",
});

export function loadShortcutSettings(): Promise<ShortcutSettings> {
  return SHORTCUTS_ADAPTER.load();
}

export function saveShortcutSettings(settings: ShortcutSettings): Promise<void> {
  return SHORTCUTS_ADAPTER.save(settings);
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
