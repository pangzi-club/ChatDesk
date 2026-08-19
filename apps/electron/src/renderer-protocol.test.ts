import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
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
});
