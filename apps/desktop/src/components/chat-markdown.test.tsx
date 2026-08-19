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
