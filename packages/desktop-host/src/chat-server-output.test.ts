import { describe, expect, it } from "vitest";
import { createChatServerOutputFormatter } from "./chat-server-output.js";

describe("createChatServerOutputFormatter", () => {
  it("prefixes unprefixed output", () => {
    const format = createChatServerOutputFormatter();

    expect(format("stdout", "Chat server listening on http://127.0.0.1:14317\n")).toBe(
      "[Chat Server] Chat server listening on http://127.0.0.1:14317\n",
    );
  });

  it("does not duplicate a prefix the Chat Server already added", () => {
    const format = createChatServerOutputFormatter();

    expect(format("stdout", "[Chat Server] browser worker: /tmp/browser-worker.mjs\n")).toBe(
      "[Chat Server] browser worker: /tmp/browser-worker.mjs\n",
    );
  });

  it("prefixes every line of a multi-line chunk", () => {
    const format = createChatServerOutputFormatter();

    expect(format("stderr", "first\nsecond\n")).toBe("[Chat Server] first\n[Chat Server] second\n");
  });

  it("keeps blank lines blank", () => {
    const format = createChatServerOutputFormatter();

    expect(format("stdout", "first\n\nsecond\n")).toBe(
      "[Chat Server] first\n\n[Chat Server] second\n",
    );
  });

  it("does not re-prefix a line split across chunks", () => {
    const format = createChatServerOutputFormatter();

    expect(format("stdout", "partial")).toBe("[Chat Server] partial");
    expect(format("stdout", " line\n")).toBe(" line\n");
  });

  it("tracks stdout and stderr independently", () => {
    const format = createChatServerOutputFormatter();

    expect(format("stdout", "out\n")).toBe("[Chat Server] out\n");
    expect(format("stderr", "err\n")).toBe("[Chat Server] err\n");
  });

  it("supports a custom prefix", () => {
    const format = createChatServerOutputFormatter({ prefix: "[Host]" });

    expect(format("stdout", "[Host] ready\n")).toBe("[Host] ready\n");
    expect(format("stdout", "next\n")).toBe("[Host] next\n");
  });

  it("indents every prefixed line and leaves blank lines unindented", () => {
    const format = createChatServerOutputFormatter({ indent: "  " });

    expect(format("stdout", "[Chat Server] ready\nsecond\n\n")).toBe(
      "  [Chat Server] ready\n  [Chat Server] second\n\n",
    );
  });
});
