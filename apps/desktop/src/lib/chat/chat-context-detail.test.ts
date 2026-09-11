import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { analyzeChatContext, createChatContextAnalyzer } from "./chat-context-detail";

describe("chat context detail", () => {
  it("keeps system and message segments in sending order", () => {
    const messages = [
      {
        id: "user-1",
        role: "user",
        parts: [
          { type: "text", text: "检查文件" },
          {
            type: "file",
            mediaType: "text/plain",
            filename: "notes.txt",
            url: "data:text/plain,x",
          },
        ],
      },
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          { type: "reasoning", text: "先读取文件" },
          {
            type: "tool-read_file",
            toolCallId: "call-1",
            state: "output-available",
            input: { path: "notes.txt" },
            output: "内容",
          },
          { type: "text", text: "读取完成" },
        ],
      },
    ] as UIMessage[];

    const result = analyzeChatContext("系统规则", messages);

    expect(result.segments.map((segment) => segment.category)).toEqual([
      "system",
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(result.segments[1]?.messageId).toBe("user-1");
    expect(result.segments[1]?.preview).toContain("notes.txt");
    expect(result.segments[2]?.preview).toContain("先读取文件");
    expect(result.segments[3]?.preview).toBe("工具：read_file");
    expect(result.segments.reduce((total, segment) => total + segment.percent, 0)).toBeCloseTo(100);
  });

  it("keeps adjacent messages separate and summarizes category usage", () => {
    const messages = [
      { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "第一条" }] },
      { id: "assistant-2", role: "assistant", parts: [{ type: "text", text: "第二条" }] },
    ] as UIMessage[];

    const result = analyzeChatContext(undefined, messages);

    expect(result.segments).toHaveLength(2);
    expect(result.segments.map((segment) => segment.messageId)).toEqual([
      "assistant-1",
      "assistant-2",
    ]);
    expect(result.summaries).toHaveLength(1);
    expect(result.summaries[0]?.category).toBe("assistant");
    expect(result.summaries[0]?.estimatedTokens).toBe(result.totalEstimatedTokens);
  });

  it("returns an empty analysis when there is no visible context", () => {
    expect(analyzeChatContext(undefined, [])).toEqual({
      segments: [],
      summaries: [],
      totalEstimatedTokens: 0,
    });
  });

  it("reuses unchanged message analysis and only estimates a changed draft", () => {
    const estimated: string[] = [];
    const analyze = createChatContextAnalyzer((value) => {
      estimated.push(value);
      return Math.ceil(value.length / 4);
    });
    const user = {
      id: "user-1",
      role: "user",
      parts: [{ type: "text", text: "问题" }],
    } as UIMessage;
    const firstDraft = {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "回" }],
    } as UIMessage;

    analyze(undefined, [user, firstDraft]);
    expect(estimated).toHaveLength(2);

    const secondDraft = {
      ...firstDraft,
      parts: [{ type: "text", text: "回答" }],
    } as UIMessage;
    const result = analyze(undefined, [user, secondDraft]);

    expect(estimated).toHaveLength(3);
    expect(result.segments[0]?.messageId).toBe("user-1");
    expect(result.segments[1]?.preview).toBe("回答");
  });
});
