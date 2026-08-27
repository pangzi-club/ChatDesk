import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  chatServerProxyHeaders,
  chatServerProxyRequestInit,
  chatServerProxyUrl,
  isEmbeddedWindowOpen,
  isRendererNavigation,
  isChatServerProxyPath,
  rendererLoadUrl,
  resolveRendererFile,
} from "./renderer-protocol.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("Electron renderer protocol", () => {
  it("serves index.html for the app origin and unknown SPA routes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-renderer-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "index.html"), "<html></html>");
    await mkdir(path.join(root, "assets"));
    await writeFile(path.join(root, "assets", "app.js"), "export {}");

    expect(resolveRendererFile(root, rendererLoadUrl())).toBe(path.join(root, "index.html"));
    expect(resolveRendererFile(root, "chatdesk://localhost/assets/app.js")).toBe(
      path.join(root, "assets", "app.js"),
    );
    expect(resolveRendererFile(root, "chatdesk://localhost/chat/session-1")).toBe(
      path.join(root, "index.html"),
    );
    expect(() => resolveRendererFile(root, "chatdesk://localhost/assets/missing.js")).toThrow();
  });

  it("rejects path traversal and foreign protocols", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-renderer-"));
    temporaryDirectories.push(root);
    await writeFile(path.join(root, "index.html"), "<html></html>");

    expect(() =>
      resolveRendererFile(root, "chatdesk://localhost/..%2F..%2Ftmp/secret.txt"),
    ).toThrow();
    expect(() => resolveRendererFile(root, "file:///etc/passwd")).toThrow();
  });

  it("allows in-app navigation on the same renderer origin", () => {
    expect(isRendererNavigation("http://localhost:1420/chat", "http://localhost:1420")).toBe(true);
    expect(isRendererNavigation("chatdesk://localhost/settings", rendererLoadUrl())).toBe(true);
    expect(isRendererNavigation("chatdesk://untrusted/settings", rendererLoadUrl())).toBe(false);
    expect(isRendererNavigation("https://example.com", "http://localhost:1420")).toBe(false);
  });

  it("distinguishes embedded-page popups from renderer links", () => {
    expect(isEmbeddedWindowOpen("https://example.com/docs", rendererLoadUrl())).toBe(true);
    expect(isEmbeddedWindowOpen("chatdesk://localhost/settings", rendererLoadUrl())).toBe(false);
    expect(isEmbeddedWindowOpen("", rendererLoadUrl())).toBe(false);
    expect(isEmbeddedWindowOpen("", rendererLoadUrl(), true)).toBe(true);
  });

  it("maps Chat Server routes to the managed loopback port", () => {
    expect(isChatServerProxyPath("/health")).toBe(true);
    expect(isChatServerProxyPath("/v1/sessions")).toBe(true);
    expect(isChatServerProxyPath("/settings")).toBe(false);
    expect(chatServerProxyUrl("chatdesk://localhost/v1/sessions?limit=20", 19000)).toBe(
      "http://127.0.0.1:19000/v1/sessions?limit=20",
    );
    expect(() => chatServerProxyUrl("chatdesk://localhost/settings", 19000)).toThrow();
    expect(() => chatServerProxyUrl("chatdesk://untrusted/v1/sessions", 19000)).toThrow();
  });

  it("removes renderer-only and transport headers before proxying", () => {
    const headers = chatServerProxyHeaders({
      Authorization: "Bearer test",
      Connection: "keep-alive",
      "Content-Length": "2",
      "Content-Type": "application/json",
      Host: "localhost",
      Origin: "chatdesk://localhost",
      "Sec-Fetch-Site": "same-origin",
    });

    expect([...headers.entries()]).toEqual([
      ["authorization", "Bearer test"],
      ["content-type", "application/json"],
    ]);
  });

  it("buffers only the request body while leaving response streaming to net.fetch", () => {
    const init = chatServerProxyRequestInit(
      "POST",
      { "Content-Type": "application/json", "Content-Length": "2" },
      new TextEncoder().encode("{}").buffer,
    );

    expect(init.method).toBe("POST");
    expect(init.headers).toEqual(new Headers({ "Content-Type": "application/json" }));
    expect(new TextDecoder().decode(init.body as Uint8Array)).toBe("{}");
  });
});
