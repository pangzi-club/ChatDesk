import type { DesktopBridge } from "@chatdesk/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { desktopFetch } from "@/lib/desktop-fetch";

const originalWindow = globalThis.window;

afterEach(() => {
  if (originalWindow) {
    globalThis.window = originalWindow;
  } else {
    Reflect.deleteProperty(globalThis, "window");
  }
});

describe("desktopFetch", () => {
  it("serializes Electron requests and reconstructs responses", async () => {
    const callSpy = vi.fn();
    const call: DesktopBridge["call"] = async <T>(
      command: string,
      args?: Record<string, unknown>,
    ) => {
      callSpy(command, args);
      return {
        status: 200,
        statusText: "OK",
        headers: [["content-type", "application/json"]],
        body: [...new TextEncoder().encode('{"ok":true}')],
      } as T;
    };
    globalThis.window = {
      __CHATDESK_DESKTOP_BRIDGE__: {
        runtime: "electron",
        call,
        subscribe: async () => () => undefined,
        readUserStore: async () => "",
        writeUserStore: async () => undefined,
        selectWorkspaceDirectory: async () => null,
        openExternal: async () => undefined,
        assetUrl: (path) => path,
        saveImageFile: async () => false,
        toggleWindowMaximize: async () => undefined,
        httpRequest: async (request) => {
          callSpy("http_request", request);
          return {
            status: 200,
            statusText: "OK",
            headers: [["content-type", "application/json"]],
            body: [...new TextEncoder().encode('{"ok":true}')],
          };
        },
        terminalSpawn: async () => ({ id: "test", shell: "sh" }),
      } satisfies DesktopBridge,
    } as unknown as Window & typeof globalThis.window;

    const response = await desktopFetch("https://example.com/api", {
      method: "POST",
      headers: { Authorization: "Bearer test" },
      body: "{}",
    });

    expect(await response.json()).toEqual({ ok: true });
    expect(callSpy).toHaveBeenCalledWith("http_request", {
      url: "https://example.com/api",
      method: "POST",
      headers: [["authorization", "Bearer test"]],
      body: "{}",
    });
  });
});
