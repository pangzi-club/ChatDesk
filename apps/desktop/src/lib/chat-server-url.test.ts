import { describe, expect, it } from "vitest";
import { resolveChatServerBaseUrl } from "@/lib/chat-server";

describe("resolveChatServerBaseUrl", () => {
  it("uses loopback for direct Chat Server access", () => {
    expect(resolveChatServerBaseUrl(14317)).toBe("http://127.0.0.1:14317");
    expect(resolveChatServerBaseUrl(19000, { proxyOrigin: null })).toBe("http://127.0.0.1:19000");
  });

  it("uses the renderer origin when Electron dev proxies Chat Server", () => {
    expect(resolveChatServerBaseUrl(14317, { proxyOrigin: "http://localhost:1420/" })).toBe(
      "http://localhost:1420",
    );
  });
});
