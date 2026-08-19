import { describe, expect, it } from "vitest";
import {
  resolveChatServerBaseUrl,
  resolveChatServerRequestInput,
  resolveElectronProxyOrigin,
} from "@/lib/chat-server";

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

  it("routes packaged Electron REST requests through the loopback HTTP bridge", () => {
    expect(
      resolveChatServerRequestInput("chatdesk://localhost/v1/sessions?limit=20", {
        runtime: "electron",
        development: false,
        port: 19000,
      }),
    ).toBe("http://127.0.0.1:19000/v1/sessions?limit=20");
    expect(
      resolveChatServerRequestInput("http://localhost:1420/v1/sessions", {
        runtime: "electron",
        development: true,
        port: 19000,
      }),
    ).toBe("http://localhost:1420/v1/sessions");
  });
});
