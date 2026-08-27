import assert from "node:assert/strict";
import { readUIMessageStream, type UIMessage } from "ai";
import { describe, it } from "vitest";
import {
  buildMockLongResponse,
  createMockLongResponseStream,
  splitMockLongResponse,
} from "./mock-long-response.ts";

function messageText(message: UIMessage) {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("");
}

describe("mock long response", () => {
  it("builds representative long Markdown content", () => {
    const text = buildMockLongResponse(24);

    assert.match(text, /^# 长文本流式回复压力测试/m);
    assert.match(text, /\| 指标 \| 数值 \| 状态 \|/);
    assert.match(text, /```ts/);
    assert.match(text, /\\sum_/);
    assert.ok(text.length > 5_000);
  });

  it("splits text without changing its contents", () => {
    const chunks = splitMockLongResponse("abcdefghijkl", 5);

    assert.deepEqual(chunks, ["abcde", "fghij", "kl"]);
    assert.equal(chunks.join(""), "abcdefghijkl");
  });

  it("streams the complete response and returns completed messages", async () => {
    const originalMessages: UIMessage[] = [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "test" }] },
    ];
    let persistedMessages: UIMessage[] | undefined;
    const stream = createMockLongResponseStream({
      messages: originalMessages,
      messageId: "assistant-1",
      delayMs: 0,
      onFinish: (messages) => {
        persistedMessages = messages;
      },
    });
    let finalMessage: UIMessage | undefined;

    for await (const message of readUIMessageStream({ stream })) finalMessage = message;

    assert.ok(finalMessage);
    assert.equal(finalMessage.id, "assistant-1");
    assert.equal(messageText(finalMessage), buildMockLongResponse());
    assert.equal(persistedMessages?.length, 2);
    assert.equal(messageText(persistedMessages?.[1] as UIMessage), buildMockLongResponse());
  });
});
