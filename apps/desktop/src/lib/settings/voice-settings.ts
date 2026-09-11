import { createSettingsAdapter } from "@/lib/settings/create-settings-adapter";

export type VoiceSettings = { enabled: boolean };
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = { enabled: false };
const VOICE_SETTINGS_STORAGE_KEY = "chatdesk-voice-settings-v1";

export function normalizeVoiceSettings(value: unknown): VoiceSettings {
  if (!value || typeof value !== "object") return DEFAULT_VOICE_SETTINGS;
  const source = value as Record<string, unknown>;
  return { enabled: source.enabled === true };
}

const VOICE_SETTINGS_ADAPTER = createSettingsAdapter<VoiceSettings>({
  storeKey: "voice",
  storageKey: VOICE_SETTINGS_STORAGE_KEY,
  eventName: "voice-settings-change",
  normalize: normalizeVoiceSettings,
  defaultValue: DEFAULT_VOICE_SETTINGS,
  label: "voice settings",
});

export function loadVoiceSettings(): Promise<VoiceSettings> {
  return VOICE_SETTINGS_ADAPTER.load();
}

export function saveVoiceSettings(value: VoiceSettings): Promise<void> {
  return VOICE_SETTINGS_ADAPTER.save(value);
}
