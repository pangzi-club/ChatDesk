import { describe, expect, it } from "vitest";
import {
  findLocalBrowserPreviewLinks,
  getBrowserPreviewTitle,
  isLocalBrowserPreviewUrl,
  normalizeBrowserPreviewUrl,
} from "@/lib/browser-preview";

describe("browser preview URLs", () => {
  it("normalizes bare local addresses and preserves URL details", () => {
    expect(normalizeBrowserPreviewUrl("localhost:5173/app?q=one#preview")).toBe(
      "http://localhost:5173/app?q=one#preview",
    );
    expect(normalizeBrowserPreviewUrl(" https://127.0.0.1:3000/path ")).toBe(
      "https://127.0.0.1:3000/path",
    );
  });

  it("rejects empty, unsupported, and invalid URLs", () => {
    expect(normalizeBrowserPreviewUrl(" ")).toBeNull();
    expect(normalizeBrowserPreviewUrl("file:///tmp/index.html")).toBeNull();
    expect(normalizeBrowserPreviewUrl("localhost:99999")).toBeNull();
  });

  it("recognizes supported local hosts", () => {
    expect(isLocalBrowserPreviewUrl("localhost:5173")).toBe(true);
    expect(isLocalBrowserPreviewUrl("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalBrowserPreviewUrl("http://0.0.0.0:4173")).toBe(true);
    expect(isLocalBrowserPreviewUrl("http://[::1]:8080")).toBe(true);
    expect(isLocalBrowserPreviewUrl("https://example.com")).toBe(false);
  });

  it("uses the host and port as the tab title", () => {
    expect(getBrowserPreviewTitle("http://localhost:5173/path")).toBe("localhost:5173");
    expect(getBrowserPreviewTitle("")).toBe("Browser");
  });
});

describe("local address discovery", () => {
  it("finds local addresses and excludes trailing punctuation", () => {
    const text = "打开 localhost:5173，然后访问 http://127.0.0.1:3000/path?q=1。";
    expect(findLocalBrowserPreviewLinks(text)).toEqual([
      {
        start: 3,
        end: 17,
        text: "localhost:5173",
        url: "http://localhost:5173/",
      },
      {
        start: 23,
        end: 53,
        text: "http://127.0.0.1:3000/path?q=1",
        url: "http://127.0.0.1:3000/path?q=1",
      },
    ]);
  });

  it("does not match embedded hostnames or public URLs", () => {
    expect(findLocalBrowserPreviewLinks("foo.localhost:5173 https://example.com")).toEqual([]);
  });
});
