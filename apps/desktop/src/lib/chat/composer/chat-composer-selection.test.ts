import { describe, expect, it } from "vitest";
import { appendComposerSelection } from "./chat-composer-selection.ts";

describe("appendComposerSelection", () => {
  it("returns the current input when the selection is empty", () => {
    expect(appendComposerSelection("hello", "   ")).toBe("hello");
    expect(appendComposerSelection("", "")).toBe("");
  });

  it("uses the selection when the composer is empty", () => {
    expect(appendComposerSelection("  ", "quoted text")).toBe("quoted text");
    expect(appendComposerSelection("", "  hello world  ")).toBe("hello world");
  });

  it("appends the selection after existing composer text", () => {
    expect(appendComposerSelection("please review", "const x = 1;")).toBe(
      "please review\n\nconst x = 1;",
    );
    expect(appendComposerSelection("draft\n", "next")).toBe("draft\n\nnext");
  });
});
