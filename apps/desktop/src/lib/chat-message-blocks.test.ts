import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { getChatMessageBlocks } from "./chat-message-blocks";

describe("getChatMessageBlocks", () => {
  it("preserves the visible order of text, reasoning, tools, sources, and files", () => {
    const message = {
      id: "assistant-1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "Checked the constraints." },
        { type: "text", text: "Result" },
        {
          type: "dynamic-tool",
          toolCallId: "tool-1",
          toolName: "web_search",
          state: "output-available",
          input: {},
          output: {},
        },
        { type: "source-url", sourceId: "source-1", url: "https://example.com" },
        { type: "source-document", sourceId: "source-2", mediaType: "text/html", title: "Docs" },
        {
          type: "file",
          mediaType: "image/png",
          filename: "result.png",
          url: "data:image/png;base64,AA==",
        },
      ],
    } as UIMessage;

    const blocks = getChatMessageBlocks(message);

    expect(blocks.map((block) => block.kind)).toEqual([
      "reasoning",
      "text",
      "tools",
      "sources",
      "files",
    ]);
    expect(blocks[3]).toMatchObject({
      kind: "sources",
      parts: [{ sourceId: "source-1" }, { sourceId: "source-2" }],
    });
  });

  it("merges adjacent parts of the same visible kind", () => {
    const message = {
      id: "assistant-2",
      role: "assistant",
      parts: [
        { type: "text", text: "Hello " },
        { type: "text", text: "world" },
        { type: "reasoning", text: "First. " },
        { type: "reasoning", text: "Second." },
      ],
    } as UIMessage;

    expect(getChatMessageBlocks(message)).toEqual([
      { kind: "text", key: "text-0", text: "Hello world" },
      { kind: "reasoning", key: "reasoning-1", text: "First. Second." },
    ]);
  });
});
