import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  isRecoverableChatTransportError,
  serializeChatTransportError,
} from "./chat-transport-diagnostics";

describe("chat transport diagnostics", () => {
  it("recognizes WebKit and fetch transport failures", () => {
    assert.equal(isRecoverableChatTransportError(new TypeError("Load failed")), true);
    assert.equal(isRecoverableChatTransportError(new TypeError("Failed to fetch")), true);
    assert.equal(isRecoverableChatTransportError(new Error("模型额度不足")), false);
  });

  it("keeps transport error metadata without recording stacks", () => {
    const cause = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    const error = new TypeError("Load failed", { cause });
    const serialized = JSON.stringify(serializeChatTransportError(error));

    assert.match(serialized, /Load failed/);
    assert.match(serialized, /ECONNRESET/);
    assert.doesNotMatch(serialized, /at .*chat-transport-diagnostics/);
  });
});
