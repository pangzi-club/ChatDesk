import { describe, expect, it } from "vitest";
import { transformLocalBrowserLinks } from "@/lib/chat-markdown-links";

describe("local Browser Markdown links", () => {
  it("turns plain local addresses into Markdown link nodes", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [{ type: "text", value: "预览 localhost:5173 完成" }],
        },
      ],
    };

    expect(transformLocalBrowserLinks(tree)).toEqual({
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            { type: "text", value: "预览 " },
            {
              type: "link",
              url: "http://localhost:5173/",
              children: [{ type: "text", value: "localhost:5173" }],
            },
            { type: "text", value: " 完成" },
          ],
        },
      ],
    });
  });

  it("preserves existing links, inline code, code blocks, and public URLs", () => {
    const tree = {
      type: "root",
      children: [
        {
          type: "paragraph",
          children: [
            {
              type: "link",
              url: "http://localhost:5173/",
              children: [{ type: "text", value: "localhost:5173" }],
            },
            { type: "text", value: " https://example.com" },
            { type: "inlineCode", value: "localhost:4173" },
          ],
        },
        { type: "code", value: "localhost:3000" },
      ],
    };

    expect(transformLocalBrowserLinks(structuredClone(tree))).toEqual(tree);
  });
});
