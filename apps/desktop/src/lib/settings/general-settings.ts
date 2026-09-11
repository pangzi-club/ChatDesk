import { getDesktopBridge } from "@/lib/runtime/desktop-bridge";
import { createSettingsAdapter } from "@/lib/settings/create-settings-adapter";

export type GeneralSettings = {
  notifyOnChatCompletion: boolean;
  notifyOnlyWhenWindowUnfocused: boolean;
  notificationPermissionVerified: boolean;
  notifyOnFeishuMessage: boolean;
};

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  notifyOnChatCompletion: false,
  notifyOnlyWhenWindowUnfocused: true,
  notificationPermissionVerified: false,
  notifyOnFeishuMessage: false,
};

const GENERAL_SETTINGS_STORAGE_KEY = "chatdesk-general-settings-v1";

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
    notifyOnFeishuMessage: record.notifyOnFeishuMessage === true,
  };
}

const GENERAL_SETTINGS_ADAPTER = createSettingsAdapter<GeneralSettings>({
  storeKey: "general",
  storageKey: GENERAL_SETTINGS_STORAGE_KEY,
  legacyStorageKeys: ["m-dashboard-general-settings-v1"],
  eventName: "general-settings-change",
  normalize: normalizeGeneralSettings,
  defaultValue: DEFAULT_GENERAL_SETTINGS,
  label: "general settings",
});

export function loadGeneralSettings(): Promise<GeneralSettings> {
  return GENERAL_SETTINGS_ADAPTER.load();
}

export function saveGeneralSettings(settings: GeneralSettings): Promise<void> {
  return GENERAL_SETTINGS_ADAPTER.save(settings);
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

export async function notifyFeishuMessage(
  title: string,
  body: string,
  onlyWhenWindowUnfocused = true,
) {
  const bridge = getDesktopBridge();
  if (bridge?.runtime !== "electron") return false;
  try {
    return (await bridge.showNotification?.(title, body, onlyWhenWindowUnfocused)) ?? false;
  } catch (error) {
    console.error("Failed to show Feishu notification", error);
    return false;
  }
}
