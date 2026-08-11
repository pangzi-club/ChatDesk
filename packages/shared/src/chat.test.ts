import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deriveTitle, isSessionStatus } from "./chat.ts";

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
});
