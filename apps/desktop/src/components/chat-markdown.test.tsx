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

describe("ChatMarkdown streaming", () => {
  it("repairs incomplete markdown only while the response is streaming", () => {
    const streaming = renderToStaticMarkup(
      <ChatMarkdown isAnimating={true}>**unfinished</ChatMarkdown>,
    );
    const complete = renderToStaticMarkup(
      <ChatMarkdown isAnimating={false}>**unfinished</ChatMarkdown>,
    );

    expect(streaming).toContain('data-streamdown="strong"');
    expect(complete).not.toContain('data-streamdown="strong"');
  });

  it("keeps local preview URLs interactive", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown isAnimating={false}>`http://localhost:3000`</ChatMarkdown>,
    );

    expect(markup).toContain("chat-local-preview-code");
    expect(markup).toContain("在 Browser 中打开 http://localhost:3000");
  });
});

describe("ChatMarkdown layout variants", () => {
  it("renders cute headings and blockquotes with the cute variant", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown isAnimating={false} variant="cute">
        {"# 小鱼\n\n> 柔和提示"}
      </ChatMarkdown>,
    );

    expect(markup).toContain('data-chat-markdown-style="cute"');
    expect(markup).toContain('data-chat-markdown-heading="cute"');
    expect(markup).toContain('data-chat-markdown-blockquote="cute"');
    expect(markup).toContain("chat-markdown-heading-icon");
  });

  it("renders geek headings with the geek variant", () => {
    const markup = renderToStaticMarkup(
      <ChatMarkdown isAnimating={false} variant="geek">
        {"## terminal"}
      </ChatMarkdown>,
    );

    expect(markup).toContain('data-chat-markdown-style="geek"');
    expect(markup).toContain('data-chat-markdown-heading="geek"');
    expect(markup).toContain("chat-markdown-heading-icon");
  });
});
