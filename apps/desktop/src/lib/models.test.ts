import { describe, expect, it } from "vitest";
import { resolveModelInputContext } from "./models.ts";

describe("model context normalization", () => {
  it("migrates legacy DeepSeek V4 128K windows to 1M", () => {
    expect(resolveModelInputContext({ name: "deepseek-v4-flash", inputContext: 128_000 })).toBe(
      1_000_000,
    );
    expect(resolveModelInputContext({ name: "deepseek-v4-pro", inputContext: 128_000 })).toBe(
      1_000_000,
    );
  });

  it("preserves explicit windows that are not legacy values", () => {
    expect(resolveModelInputContext({ name: "deepseek-v4-flash", inputContext: 512_000 })).toBe(
      512_000,
    );
  });

  it("uses the known window when a preset model has no saved value", () => {
    expect(resolveModelInputContext({ name: "deepseek-v4-flash" })).toBe(1_000_000);
  });
});
