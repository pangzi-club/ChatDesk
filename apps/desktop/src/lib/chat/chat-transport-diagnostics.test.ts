import { describe, expect, it } from "vitest";
import {
  isRecoverableChatTransportError,
  serializeChatTransportError,
} from "./chat-transport-diagnostics";

describe("chat transport diagnostics", () => {
  it("recognizes WebKit and fetch transport failures", () => {
    expect(isRecoverableChatTransportError(new TypeError("Load failed"))).toBe(true);
    expect(isRecoverableChatTransportError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isRecoverableChatTransportError(new Error("模型额度不足"))).toBe(false);
  });

  it("keeps transport error metadata without recording stacks", () => {
    const cause = Object.assign(new Error("connection reset"), { code: "ECONNRESET" });
    const error = Object.assign(new TypeError("Load failed"), { cause });
    const serialized = JSON.stringify(serializeChatTransportError(error));

    expect(serialized).toMatch(/Load failed/);
    expect(serialized).toMatch(/ECONNRESET/);
    expect(serialized).not.toMatch(/at .*chat-transport-diagnostics/);
  });
});
