import type { WhisperModelId } from "@chatdesk/shared";
import { getDesktopBridge, isDesktop } from "@/lib/desktop-bridge";
import { settingsStore } from "@/lib/settings-store";

export type VoiceSettings = { enabled: boolean; language: string; modelId: WhisperModelId | "" };
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  enabled: false,
  language: "zh",
  modelId: "",
};
const STORE_KEY = "voice";

export function normalizeVoiceSettings(value: unknown): VoiceSettings {
  if (!value || typeof value !== "object") return DEFAULT_VOICE_SETTINGS;
  const source = value as Record<string, unknown>;
  const ids = new Set(["tiny", "tiny.en", "base", "small", "medium", "large-v3-turbo"]);
  return {
    enabled: source.enabled === true,
    language: typeof source.language === "string" && source.language ? source.language : "zh",
    modelId:
      typeof source.modelId === "string" && ids.has(source.modelId)
        ? (source.modelId as VoiceSettings["modelId"])
        : "",
  };
}

export async function loadVoiceSettings() {
  if (isDesktop()) return normalizeVoiceSettings(await settingsStore.get(STORE_KEY));
  try {
    const raw = window.localStorage.getItem("chatdesk-voice-settings-v1");
    return normalizeVoiceSettings(raw ? JSON.parse(raw) : undefined);
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

export async function saveVoiceSettings(value: VoiceSettings) {
  const settings = normalizeVoiceSettings(value);
  if (isDesktop()) {
    await settingsStore.set(STORE_KEY, settings);
    await settingsStore.save();
  } else window.localStorage.setItem("chatdesk-voice-settings-v1", JSON.stringify(settings));
  window.dispatchEvent(new CustomEvent("voice-settings-change", { detail: settings }));
}

export function getVoiceBridge() {
  return getDesktopBridge();
}
