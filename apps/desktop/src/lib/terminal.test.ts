import { describe, expect, it } from "vitest";
import { terminalEventBytes } from "./terminal";

describe("terminalEventBytes", () => {
  it("converts channel arrays to bytes", () => {
    expect(terminalEventBytes([27, 91, 51, 49, 109])).toEqual(
      Uint8Array.from([27, 91, 51, 49, 109]),
    );
  });

  it("preserves byte arrays", () => {
    const bytes = Uint8Array.from([228, 184, 173]);
    expect(terminalEventBytes(bytes)).toBe(bytes);
  });
});
