import { getDesktopBridge, isDesktop } from "@/lib/desktop-bridge";
import { settingsStore } from "@/lib/settings-store";

export type GeneralSettings = {
  notifyOnChatCompletion: boolean;
  notifyOnlyWhenWindowUnfocused: boolean;
  notificationPermissionVerified: boolean;
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  notifyOnChatCompletion: false,
  notifyOnlyWhenWindowUnfocused: true,
  notificationPermissionVerified: false,
};

const GENERAL_SETTINGS_STORE_KEY = "general";
const GENERAL_SETTINGS_STORAGE_KEY = "m-dashboard-general-settings-v1";

function normalizeGeneralSettings(value: unknown): GeneralSettings {
  if (!value || typeof value !== "object") return DEFAULT_GENERAL_SETTINGS;
  const record = value as Record<string, unknown>;
  const notificationPermissionVerified = record.notificationPermissionVerified === true;
  return {
    notifyOnChatCompletion:
      notificationPermissionVerified && record.notifyOnChatCompletion === true,
    notifyOnlyWhenWindowUnfocused:
      typeof record.notifyOnlyWhenWindowUnfocused === "boolean"
        ? record.notifyOnlyWhenWindowUnfocused
        : DEFAULT_GENERAL_SETTINGS.notifyOnlyWhenWindowUnfocused,
    notificationPermissionVerified,
  };
}

export async function loadGeneralSettings(): Promise<GeneralSettings> {
  if (isDesktop()) {
    try {
      const stored = await settingsStore.get<unknown>(GENERAL_SETTINGS_STORE_KEY);
      if (stored) return normalizeGeneralSettings(stored);
    } catch (error) {
      console.error("Failed to load general settings from Tauri Store", error);
    }
  }

  try {
    const raw = window.localStorage.getItem(GENERAL_SETTINGS_STORAGE_KEY);
    if (raw) return normalizeGeneralSettings(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to load general settings from localStorage", error);
  }
  return DEFAULT_GENERAL_SETTINGS;
}

export async function saveGeneralSettings(settings: GeneralSettings) {
  const normalized = normalizeGeneralSettings(settings);
  if (isDesktop()) {
    try {
      await settingsStore.set(GENERAL_SETTINGS_STORE_KEY, normalized);
      await settingsStore.save();
      window.localStorage.removeItem(GENERAL_SETTINGS_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent("general-settings-change", { detail: normalized }));
      return;
    } catch (error) {
      console.error("Failed to save general settings to Tauri Store", error);
    }
  }
  window.localStorage.setItem(GENERAL_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("general-settings-change", { detail: normalized }));
}

export async function requestNotificationPermission() {
  const bridge = getDesktopBridge();
  if (bridge?.runtime !== "electron") return false;
  try {
    return (await bridge.requestNotificationPermission?.()) ?? false;
  } catch (error) {
    console.error("Failed to request desktop notification permission", error);
    return false;
  }
}

export async function notifyChatCompletion(title: string, onlyWhenWindowUnfocused: boolean) {
  const bridge = getDesktopBridge();
  if (bridge?.runtime !== "electron") return false;
  try {
    return (await bridge.showNotification?.("对话已完成", title, onlyWhenWindowUnfocused)) ?? false;
  } catch (error) {
    console.error("Failed to show chat completion notification", error);
    return false;
  }
}
