import { createSettingsAdapter } from "@/lib/settings/create-settings-adapter";

export type DeveloperSettings = {
  mockLongResponse: boolean;
  showAllTasks: boolean;
  showDemoPlugins: boolean;
};

export const DEFAULT_DEVELOPER_SETTINGS: DeveloperSettings = {
  mockLongResponse: false,
  showAllTasks: false,
  showDemoPlugins: false,
};

const DEVELOPER_SETTINGS_STORAGE_KEY = "chatdesk-developer-settings-v1";

export function normalizeDeveloperSettings(value: unknown): DeveloperSettings {
  if (!value || typeof value !== "object") return DEFAULT_DEVELOPER_SETTINGS;
  return {
    mockLongResponse: (value as Record<string, unknown>).mockLongResponse === true,
    showAllTasks: (value as Record<string, unknown>).showAllTasks === true,
    showDemoPlugins: (value as Record<string, unknown>).showDemoPlugins === true,
  };
}

const DEVELOPER_SETTINGS_ADAPTER = createSettingsAdapter<DeveloperSettings>({
  storeKey: "developer",
  storageKey: DEVELOPER_SETTINGS_STORAGE_KEY,
  eventName: "developer-settings-change",
  normalize: normalizeDeveloperSettings,
  defaultValue: DEFAULT_DEVELOPER_SETTINGS,
  label: "developer settings",
});

export function loadDeveloperSettings(): Promise<DeveloperSettings> {
  return DEVELOPER_SETTINGS_ADAPTER.load();
}

export function saveDeveloperSettings(settings: DeveloperSettings): Promise<void> {
  return DEVELOPER_SETTINGS_ADAPTER.save(settings);
}
