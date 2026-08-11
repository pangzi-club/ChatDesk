import { invoke } from "@tauri-apps/api/core";

import { settingsStore } from "@/lib/settings-store";

const TRAY_ENABLED_STORE_KEY = "tray-enabled";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadTrayEnabled() {
  const stored = await settingsStore.get<unknown>(TRAY_ENABLED_STORE_KEY);
  return typeof stored === "boolean" ? stored : true;
}

export async function saveTrayEnabled(enabled: boolean) {
  await settingsStore.set(TRAY_ENABLED_STORE_KEY, enabled);
  await settingsStore.save();
  if (isTauri()) {
    await invoke("set_tray_enabled", { enabled });
  }
}

export async function applyTrayEnabled(enabled: boolean) {
  if (isTauri()) {
    await invoke("set_tray_enabled", { enabled });
  }
}
