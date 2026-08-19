import { describe, expect, it } from "vitest";
import {
  findLocalBrowserPreviewLinks,
  getBrowserNavigationState,
  getBrowserPreviewTitle,
  isLocalBrowserPreviewUrl,
  moveBrowserNavigation,
  normalizeBrowserPreviewUrl,
  pushBrowserNavigation,
} from "@/lib/browser-preview";

describe("browser preview URLs", () => {
  it("normalizes bare local addresses and preserves URL details", () => {
    expect(normalizeBrowserPreviewUrl("localhost:5173/app?q=one#preview")).toBe(
      "http://localhost:5173/app?q=one#preview",
    );
    expect(normalizeBrowserPreviewUrl(" https://127.0.0.1:3000/path ")).toBe(
      "https://127.0.0.1:3000/path",
    );
    expect(normalizeBrowserPreviewUrl("example.com/docs")).toBe("https://example.com/docs");
    expect(normalizeBrowserPreviewUrl("example.com:8443/docs")).toBe(
      "https://example.com:8443/docs",
    );
    expect(normalizeBrowserPreviewUrl("//example.com/docs")).toBe("https://example.com/docs");
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

describe("browser navigation history", () => {
  it("pushes navigation and drops the forward branch", () => {
    const first = pushBrowserNavigation({}, "https://example.com/");
    const second = pushBrowserNavigation(
      { browserNavigation: first, url: "https://example.com/" },
      "https://openai.com/",
    );
    const back = moveBrowserNavigation(
      { browserNavigation: second, url: "https://openai.com/" },
      -1,
    );
    const branched = pushBrowserNavigation(
      { browserNavigation: back?.browserNavigation, url: back?.url },
      "https://developer.mozilla.org/",
    );

    expect(branched).toEqual({
      entries: ["https://example.com/", "https://developer.mozilla.org/"],
      index: 1,
    });
  });

  it("moves backward and forward within available entries", () => {
    const browserNavigation = {
      entries: ["https://example.com/", "https://openai.com/"],
      index: 1,
    };
    const back = moveBrowserNavigation({ browserNavigation, url: "https://openai.com/" }, -1);

    expect(back).toEqual({
      browserNavigation: { entries: browserNavigation.entries, index: 0 },
      url: "https://example.com/",
    });
    expect(
      moveBrowserNavigation({ browserNavigation: back?.browserNavigation, url: back?.url }, 1),
    ).toEqual({
      browserNavigation,
      url: "https://openai.com/",
    });
    expect(moveBrowserNavigation({ browserNavigation, url: "https://openai.com/" }, 1)).toBeNull();
    expect(getBrowserNavigationState({})).toEqual({ entries: [], index: -1 });
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
