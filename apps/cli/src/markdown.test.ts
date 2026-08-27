import assert from "node:assert/strict";
import { renderToString } from "ink";
import { createElement as h } from "react";
import { describe, it } from "vitest";
import { MarkdownView, parseMarkdown, renderMarkdown } from "./markdown.ts";

const sample = `# 标题

这是 **粗体** 和 *斜体*，还有 \`code\`。

- 一项
- 二项

> 引用内容

\`\`\`ts
const n = 1;
\`\`\`

见 [文档](https://example.com)。

![示意图](https://example.com/a.png)

公式 $E=mc^2$ 结束。
`;

describe("markdown", () => {
  it("parses headings, emphasis, lists, code, quotes, and links", () => {
    const blocks = parseMarkdown(sample);
    assert.equal(blocks[0]?.type, "heading");
    assert.equal(
      blocks.some((block) => block.type === "list"),
      true,
    );
    assert.equal(
      blocks.some((block) => block.type === "code"),
      true,
    );
    assert.equal(
      blocks.some((block) => block.type === "blockquote"),
      true,
    );
    const paragraph = blocks.find((block) => block.type === "paragraph");
    assert.ok(paragraph && paragraph.type === "paragraph");
    assert.equal(
      paragraph.children.some((node) => node.type === "strong"),
      true,
    );
  });

  it("renders ANSI styles on TTY and plain text otherwise", () => {
    const colored = renderMarkdown("**粗体** 和 [链接](https://example.com)", { color: true });
    const plain = renderMarkdown("**粗体** 和 [链接](https://example.com)", { color: false });
    assert.ok(colored.includes("\u001b["));
    assert.match(colored, /粗体/);
    assert.match(colored, /https:\/\/example.com/);
    assert.equal(plain.includes("\u001b["), false);
    assert.match(plain, /粗体/);
    assert.match(plain, /链接/);
  });

  it("falls back safely for images, math, and unknown markup", () => {
    const plain = renderMarkdown("![alt](https://img) 和 $$x^2$$ 以及 <script>nope</script>", {
      color: false,
    });
    assert.match(plain, /\[图片: alt\]/);
    assert.match(plain, /https:\/\/img/);
    assert.match(plain, /\[公式\] x\^2/);
    assert.match(plain, /<script>nope<\/script>/);
    assert.equal(plain.includes("<img"), false);
  });

  it("renders the same document through Ink nodes", () => {
    const output = renderToString(h(MarkdownView, { source: sample }));
    assert.match(output, /标题/);
    assert.match(output, /粗体/);
    assert.match(output, /const n = 1/);
    assert.match(output, /文档/);
    assert.match(output, /\[图片: 示意图\]/);
    assert.match(output, /\[公式\] E=mc\^2/);
  });
});
