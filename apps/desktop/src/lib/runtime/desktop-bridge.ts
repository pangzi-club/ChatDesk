import type { DesktopBridge } from "@chatdesk/shared";

export type { DesktopBridge, DesktopRuntime, DesktopUserStoreFile } from "@chatdesk/shared";

declare global {
  interface Window {
    __CHATDESK_DESKTOP_BRIDGE__?: DesktopBridge;
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  if (typeof window !== "undefined" && window.__CHATDESK_DESKTOP_BRIDGE__) {
    return window.__CHATDESK_DESKTOP_BRIDGE__;
  }
  return null;
}

export function isDesktop() {
  return getDesktopBridge() !== null;
}
