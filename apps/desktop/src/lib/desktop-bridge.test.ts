import type { DesktopBridge } from "@chatdesk/shared";
import { afterEach, describe, expect, it } from "vitest";
import { getDesktopBridge, isDesktop } from "@/lib/desktop-bridge";

const originalWindow = globalThis.window;

function restoreWindow() {
  if (originalWindow) {
    globalThis.window = originalWindow;
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
}

afterEach(restoreWindow);

describe("desktop bridge", () => {
  it("uses the injected Electron bridge when present", () => {
    const bridge: DesktopBridge = {
      runtime: "electron",
      call: async <T>() => null as T,
      subscribe: async () => () => undefined,
      readUserStore: async () => "{}",
      writeUserStore: async () => undefined,
      selectWorkspaceDirectory: async () => null,
      openExternal: async () => undefined,
      assetUrl: (path) => `asset://${path}`,
      saveImageFile: async () => true,
      setTrayEnabled: async () => undefined,
      toggleWindowMaximize: async () => undefined,
    };

    globalThis.window = { __CHATDESK_DESKTOP_BRIDGE__: bridge } as Window &
      typeof globalThis.window;

    expect(getDesktopBridge()).toBe(bridge);
    expect(isDesktop()).toBe(true);
  });

  it("does not report desktop capabilities for a normal web window", () => {
    globalThis.window = {} as Window & typeof globalThis.window;

    expect(getDesktopBridge()).toBeNull();
    expect(isDesktop()).toBe(false);
  });
});
