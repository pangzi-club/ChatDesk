import { describe, expect, it } from "vitest";
import {
  isChatServerProtocolInput,
  resolveChatServerBaseUrl,
  resolveElectronProxyOrigin,
} from "@/lib/server/chat-server";

describe("resolveChatServerBaseUrl", () => {
  it("uses loopback for direct Chat Server access", () => {
    expect(resolveChatServerBaseUrl(14317)).toBe("http://127.0.0.1:14317");
    expect(resolveChatServerBaseUrl(19000, { proxyOrigin: null })).toBe("http://127.0.0.1:19000");
  });

  it("uses the renderer origin when Electron proxies Chat Server", () => {
    expect(resolveChatServerBaseUrl(14317, { proxyOrigin: "http://localhost:1420/" })).toBe(
      "http://localhost:1420",
    );
  });

  it("uses the registered renderer scheme in packaged Electron", () => {
    expect(
      resolveElectronProxyOrigin({
        runtime: "electron",
        development: false,
        rendererOrigin: "null",
      }),
    ).toBe("chatdesk://localhost");
    expect(
      resolveElectronProxyOrigin({
        runtime: "electron",
        development: true,
        rendererOrigin: "http://localhost:1420",
      }),
    ).toBe("http://localhost:1420");
  });

  it("recognizes requests already on the packaged Electron renderer protocol", () => {
    expect(isChatServerProtocolInput("chatdesk://localhost/v1/sessions?limit=20")).toBe(true);
    expect(isChatServerProtocolInput("http://localhost:1420/v1/sessions")).toBe(false);
  });
});
