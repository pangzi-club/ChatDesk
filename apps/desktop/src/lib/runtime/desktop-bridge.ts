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

/**
 * Subscribe to a desktop bridge event and return a synchronous disposer, which
 * makes it safe to use directly as a `useEffect` cleanup.
 *
 * `DesktopBridge.subscribe` resolves asynchronously, so bookkeeping the
 * disposer inside `.then()` leaks the subscription whenever the component
 * unmounts before the promise settles. This helper compensates by disposing
 * immediately when the subscription resolves after release, and swallows
 * bridge failures instead of leaving an unhandled rejection.
 */
export function subscribeBridgeEvent(
  event: string,
  listener: (payload: unknown) => void,
): () => void {
  const bridge = getDesktopBridge();
  if (!bridge) return () => {};
  let active = true;
  let dispose: (() => void) | undefined;
  void bridge
    .subscribe(event, listener)
    .then((cleanup) => {
      if (active) dispose = cleanup;
      else cleanup();
    })
    .catch((error) => {
      console.error(`Failed to subscribe to desktop event "${event}"`, error);
    });
  return () => {
    active = false;
    dispose?.();
    dispose = undefined;
  };
}
