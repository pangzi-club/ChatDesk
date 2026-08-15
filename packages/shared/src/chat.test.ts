import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  deriveTitle,
  isSessionStatus,
  resolveContextCompactionThreshold,
  resolveModelContextWindow,
} from "./chat.ts";

describe("shared chat contracts", () => {
  it("derives a bounded title from the first user message", () => {
    const title = deriveTitle([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "  帮我检查这个项目的构建问题  " }],
      },
    ]);
    assert.equal(title, "帮我检查这个项目的构建问题");
  });

  it("validates known session statuses", () => {
    assert.equal(isSessionStatus("streaming"), true);
    assert.equal(isSessionStatus("unknown"), false);
  });

  it("resolves model context windows and compaction thresholds", () => {
    assert.equal(resolveModelContextWindow(undefined), DEFAULT_MODEL_CONTEXT_WINDOW);
    assert.equal(resolveModelContextWindow(256_000), 256_000);
    assert.equal(resolveContextCompactionThreshold(undefined), 96_000);
    assert.equal(resolveContextCompactionThreshold(80_000), 60_000);
    assert.equal(resolveContextCompactionThreshold(1_000_000), 750_000);
  });
});
