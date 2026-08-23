import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { chatServerCorsOrigin, isAllowedChatServerCorsOrigin } from "./cors.ts";

describe("chat server CORS origins", () => {
  it("allows the Vite and Electron renderer origins", () => {
    assert.equal(isAllowedChatServerCorsOrigin("http://localhost:1420"), true);
    assert.equal(isAllowedChatServerCorsOrigin("http://127.0.0.1:1420"), true);
    assert.equal(isAllowedChatServerCorsOrigin("http://127.0.0.1:5173"), true);
    assert.equal(isAllowedChatServerCorsOrigin("chatdesk://localhost"), true);
    assert.equal(isAllowedChatServerCorsOrigin("null"), true);
  });

  it("rejects remote and missing origins", () => {
    assert.equal(isAllowedChatServerCorsOrigin(""), false);
    assert.equal(isAllowedChatServerCorsOrigin("https://example.com"), false);
    assert.equal(isAllowedChatServerCorsOrigin("file://"), false);
    assert.equal(chatServerCorsOrigin("https://evil.example"), null);
    assert.equal(chatServerCorsOrigin("chatdesk://localhost"), "chatdesk://localhost");
  });
});
