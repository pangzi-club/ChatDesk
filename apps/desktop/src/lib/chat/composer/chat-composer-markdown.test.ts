import { describe, expect, it } from "vitest";
import {
  mapPlainOffsetToPmPos,
  parseComposerMarkdown,
  serializeComposerMarkdown,
} from "./chat-composer-markdown.ts";

function roundtrip(text: string) {
  expect(serializeComposerMarkdown(parseComposerMarkdown(text))).toBe(text);
}

describe("composer markdown codec", () => {
  it("roundtrips plain text, newlines, and empty input", () => {
    roundtrip("");
    roundtrip("hello");
    roundtrip("line1\nline2");
    roundtrip("line1\n\nline2");
    roundtrip("trailing\n");
  });

  it("roundtrips bold, inline code, and mixed marks", () => {
    roundtrip("**bold**");
    roundtrip("hello **world**");
    roundtrip("`code`");
    roundtrip("use `foo` and **bar**");
    roundtrip("中文**强调**文本");
    roundtrip("**a `b` c**");
    roundtrip("`**not bold**`");
  });

  it("roundtrips unordered and ordered lists", () => {
    roundtrip("- a");
    roundtrip("- a\n- b");
    roundtrip("1. a");
    roundtrip("1. a\n2. b");
    roundtrip("3. starts later");
    roundtrip("hello\n- a\n- b\nworld");
    roundtrip("- **bold** item");
    roundtrip("- use `code`");
  });

  it("canonicalizes star unordered lists to dashes", () => {
    expect(serializeComposerMarkdown(parseComposerMarkdown("* a\n* b"))).toBe("- a\n- b");
  });

  it("keeps unmatched markers as literal text", () => {
    roundtrip("**not closed");
    roundtrip("`not closed");
    roundtrip("a * b");
  });

  it("does not treat heading-like or italic-like text as rich blocks", () => {
    roundtrip("# not a heading");
    roundtrip("> not a quote");
    roundtrip("*not a list*");
  });

  it("maps a plain-text caret onto a ProseMirror-style position", () => {
    const doc = {
      content: { size: 5 },
      textBetween(from: number, to: number) {
        const text = "hello";
        return text.slice(from, to);
      },
    };
    expect(mapPlainOffsetToPmPos(doc, 0)).toBe(0);
    expect(mapPlainOffsetToPmPos(doc, 2)).toBe(2);
    expect(mapPlainOffsetToPmPos(doc, 5)).toBe(5);
    expect(mapPlainOffsetToPmPos(doc, 99)).toBe(5);
  });
});
