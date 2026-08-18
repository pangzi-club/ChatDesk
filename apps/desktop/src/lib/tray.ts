import { getDesktopBridge } from "@/lib/desktop-bridge";
import { settingsStore } from "@/lib/settings-store";

const TRAY_ENABLED_STORE_KEY = "tray-enabled";

export async function loadTrayEnabled() {
  const stored = await settingsStore.get<unknown>(TRAY_ENABLED_STORE_KEY);
  return typeof stored === "boolean" ? stored : true;
}

export async function saveTrayEnabled(enabled: boolean) {
  await settingsStore.set(TRAY_ENABLED_STORE_KEY, enabled);
  await settingsStore.save();
  await getDesktopBridge()?.setTrayEnabled(enabled);
}

export async function applyTrayEnabled(enabled: boolean) {
  await getDesktopBridge()?.setTrayEnabled(enabled);
}
