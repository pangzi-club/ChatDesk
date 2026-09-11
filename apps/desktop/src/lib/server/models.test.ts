import { describe, expect, it } from "vitest";
import {
  formatModelContextSize,
  getDefaultModel,
  resolveModelInputContext,
  sortModelsByName,
} from "./models.ts";

describe("model sorting", () => {
  it("sorts names naturally without mutating the saved order", () => {
    const models = [{ name: "model-10" }, { name: "Alpha" }, { name: "model-2" }];

    expect(sortModelsByName(models).map((model) => model.name)).toEqual([
      "Alpha",
      "model-2",
      "model-10",
    ]);
    expect(models.map((model) => model.name)).toEqual(["model-10", "Alpha", "model-2"]);
  });
});

describe("default model selection", () => {
  it("returns the explicitly configured default instead of the first model", () => {
    const models = [
      { id: "first", isDefault: false },
      { id: "default", isDefault: true },
    ];

    expect(getDefaultModel(models)?.id).toBe("default");
  });

  it("returns undefined when no default model is configured", () => {
    expect(getDefaultModel([{ id: "only", isDefault: false }])).toBeUndefined();
  });
});

describe("model context formatting", () => {
  it("formats context sizes for the model list", () => {
    expect(formatModelContextSize(1_000_000)).toBe("1M tokens");
    expect(formatModelContextSize(204_800)).toBe("204.8K tokens");
    expect(formatModelContextSize(800)).toBe("800 tokens");
    expect(formatModelContextSize(undefined)).toBe("未设置");
    expect(formatModelContextSize(Number.NaN)).toBe("未设置");
  });
});

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
    expect(resolveModelInputContext({ name: "deepseek-v4-flash-vision-exp" })).toBe(1_000_000);
  });
});
