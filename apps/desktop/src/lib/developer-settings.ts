import { isDesktop } from "@/lib/desktop-bridge";
import { settingsStore } from "@/lib/settings-store";

export type DeveloperSettings = {
  mockLongResponse: boolean;
  showAllTasks: boolean;
};

export const DEFAULT_DEVELOPER_SETTINGS: DeveloperSettings = {
  mockLongResponse: false,
  showAllTasks: false,
};

const DEVELOPER_SETTINGS_STORE_KEY = "developer";
const DEVELOPER_SETTINGS_STORAGE_KEY = "chatdesk-developer-settings-v1";

export function normalizeDeveloperSettings(value: unknown): DeveloperSettings {
  if (!value || typeof value !== "object") return DEFAULT_DEVELOPER_SETTINGS;
  return {
    mockLongResponse: (value as Record<string, unknown>).mockLongResponse === true,
    showAllTasks: (value as Record<string, unknown>).showAllTasks === true,
  };
}

export async function loadDeveloperSettings(): Promise<DeveloperSettings> {
  if (isDesktop()) {
    try {
      const stored = await settingsStore.get<unknown>(DEVELOPER_SETTINGS_STORE_KEY);
      if (stored) return normalizeDeveloperSettings(stored);
    } catch (error) {
      console.error("Failed to load developer settings from desktop store", error);
    }
  }

  try {
    const raw = window.localStorage.getItem(DEVELOPER_SETTINGS_STORAGE_KEY);
    if (raw) return normalizeDeveloperSettings(JSON.parse(raw));
  } catch (error) {
    console.error("Failed to load developer settings from localStorage", error);
  }
  return DEFAULT_DEVELOPER_SETTINGS;
}

export async function saveDeveloperSettings(settings: DeveloperSettings) {
  const normalized = normalizeDeveloperSettings(settings);
  if (isDesktop()) {
    try {
      await settingsStore.set(DEVELOPER_SETTINGS_STORE_KEY, normalized);
      await settingsStore.save();
      window.localStorage.removeItem(DEVELOPER_SETTINGS_STORAGE_KEY);
      window.dispatchEvent(new CustomEvent("developer-settings-change", { detail: normalized }));
      return;
    } catch (error) {
      console.error("Failed to save developer settings to desktop store", error);
    }
  }
  window.localStorage.setItem(DEVELOPER_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
  window.dispatchEvent(new CustomEvent("developer-settings-change", { detail: normalized }));
}
