import type { DesktopBridge } from "@chatdesk/shared";
import { convertFileSrc, invoke, isTauri as tauriIsTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";

export type { DesktopBridge, DesktopRuntime, DesktopUserStoreFile } from "@chatdesk/shared";

declare global {
  interface Window {
    __CHATDESK_DESKTOP_BRIDGE__?: DesktopBridge;
  }
}

const tauriBridge: DesktopBridge = {
  runtime: "tauri",
  call: <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args),
  subscribe: async (event, listener) => {
    const unlisten = await listen(event, (event) => listener(event.payload));
    return unlisten;
  },
  readUserStore: (fileName) => invoke<string>("read_user_store", { fileName }),
  writeUserStore: (fileName, contents) => invoke("write_user_store", { fileName, contents }),
  selectWorkspaceDirectory: () => invoke<string | null>("select_workspace_directory"),
  openExternal: (url) => openUrl(url),
  assetUrl: (path) => convertFileSrc(path),
  saveImageFile: (bytes, fileName) => invoke<boolean>("save_image_file", { bytes, fileName }),
  setTrayEnabled: (enabled) => invoke("set_tray_enabled", { enabled }),
  toggleWindowMaximize: () => getCurrentWindow().toggleMaximize(),
};

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window !== "undefined" && window.__CHATDESK_DESKTOP_BRIDGE__) {
    return window.__CHATDESK_DESKTOP_BRIDGE__;
  }
  if (tauriIsTauri() || (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window)) {
    return tauriBridge;
  }
  return null;
}

export function isDesktop() {
  return getDesktopBridge() !== null;
}
