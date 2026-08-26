import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";

vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

import { createWebTools } from "./web-tools.ts";

afterEach(() => vi.unstubAllGlobals());

describe("web_fetch", () => {
  it("extracts readable text from HTML", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            "<html><head><style>hidden</style></head><body><h1>Title</h1><script>bad()</script><p>Hello &amp; world</p></body></html>",
            { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
          ),
      ),
    );
    const execute = createWebTools().web_fetch.execute;
    if (typeof execute !== "function") throw new Error("web_fetch execute missing");
    const result = (await execute(
      { url: "https://example.com/page" },
      {} as Parameters<typeof execute>[1],
    )) as { content: string; truncated: boolean };
    assert.equal(result.content, "Title\nHello & world");
    assert.equal(result.truncated, false);
  });

  it("rejects localhost and private targets before fetching", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const execute = createWebTools().web_fetch.execute;
    if (typeof execute !== "function") throw new Error("web_fetch execute missing");
    await assert.rejects(
      () => execute({ url: "http://127.0.0.1:8080/secret" }, {} as Parameters<typeof execute>[1]),
      /不允许访问本机或内网地址/,
    );
    assert.equal(fetchMock.mock.calls.length, 0);
  });

  it("validates redirect targets and follows public redirects", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "/next" } }))
      .mockResolvedValueOnce(new Response("plain text", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const execute = createWebTools().web_fetch.execute;
    if (typeof execute !== "function") throw new Error("web_fetch execute missing");
    const result = (await execute(
      { url: "https://example.com/start" },
      {} as Parameters<typeof execute>[1],
    )) as { url: string; content: string };
    assert.equal(result.url, "https://example.com/next");
    assert.equal(result.content, "plain text");
    assert.equal(fetchMock.mock.calls.length, 2);
  });
});
