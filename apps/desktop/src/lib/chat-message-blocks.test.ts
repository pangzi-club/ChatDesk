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

  it("keeps the final answer immediately after the plan_write tool block", () => {
    const message = {
      id: "assistant-plan",
      role: "assistant",
      parts: [
        {
          type: "tool-plan_write",
          toolCallId: "plan-call",
          state: "output-available",
          input: { content: "# Plan" },
          output: { characters: 6 },
        },
        { type: "step-start" },
        { type: "text", text: "The plan is ready." },
      ],
    } as UIMessage;

    const blocks = getChatMessageBlocks(message);

    expect(blocks.map((block) => block.kind)).toEqual(["tools", "text"]);
    expect(blocks[1]).toMatchObject({ kind: "text", text: "The plan is ready." });
  });

  it("splits create_task parts into a tasks block instead of merging with tools", () => {
    const message = {
      id: "assistant-tasks",
      role: "assistant",
      parts: [
        {
          type: "tool-read_file",
          toolCallId: "read-1",
          state: "output-available",
          input: { path: "README.md" },
          output: { content: "ok" },
        },
        {
          type: "tool-create_task",
          toolCallId: "task-1",
          state: "output-available",
          input: { prompt: "调研 A", title: "任务 A" },
          output: {
            sessionId: "session-a",
            title: "任务 A",
            status: "completed",
            preview: "完成 A",
          },
        },
        {
          type: "tool-create_task",
          toolCallId: "task-2",
          state: "input-available",
          input: { prompt: "调研 B", title: "任务 B" },
        },
        {
          type: "tool-bash",
          toolCallId: "bash-1",
          state: "output-available",
          input: { command: "ls" },
          output: { stdout: "a" },
        },
      ],
    } as UIMessage;

    const blocks = getChatMessageBlocks(message);
    expect(blocks.map((block) => block.kind)).toEqual(["tools", "tasks", "tools"]);
    expect(blocks[1]).toMatchObject({
      kind: "tasks",
      parts: [{ toolCallId: "task-1" }, { toolCallId: "task-2" }],
    });
  });
});
