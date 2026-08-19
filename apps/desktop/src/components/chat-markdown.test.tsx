import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ChatMarkdown } from "./chat-markdown";

describe("ChatMarkdown math", () => {
  it("renders inline and display math with KaTeX", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown isAnimating={false}>{"Inline $x^2$\n\n$$\n\\sum_{i=1}^n i\n$$"}</ChatMarkdown>,
    );

    expect(markup).toContain("katex");
    expect(markup).toContain("katex-display");
    expect(markup).not.toContain("$x^2$");
  });
});

describe("ChatMarkdown CJK", () => {
  it("renders Chinese text with adjacent emphasis", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown isAnimating={false}>{"中文**强调**文本"}</ChatMarkdown>,
    );

    expect(markup).toContain(
      `<div class="space-y-4 whitespace-normal [&amp;&gt;*:first-child]:mt-0 [&amp;&gt;*:last-child]:mb-0"><p>中文<span class="font-semibold" data-streamdown="strong">强调</span>文本</p></div>`,
    );
  });
});
