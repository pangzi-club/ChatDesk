import { createUIMessageStream, createUIMessageStreamResponse, type UIMessage } from "ai";

const MOCK_SECTION_COUNT = 120;
const MOCK_CHUNK_SIZE = 16;
const MOCK_CHUNK_DELAY_MS = 1;

export function buildMockLongResponse(sectionCount = MOCK_SECTION_COUNT) {
  const sections = Array.from({ length: sectionCount }, (_, index) => {
    const number = index + 1;
    const extras = [
      number % 8 === 0
        ? `\n| 指标 | 数值 | 状态 |\n| --- | ---: | --- |\n| 渲染批次 | ${number * 7} | 正常 |\n| 累计字符 | ${number * 512} | 增长中 |\n`
        : "",
      number % 10 === 0
        ? `\n\`\`\`ts\nfunction renderSection${number}(value: string) {\n  return value.repeat(${(number % 4) + 1});\n}\n\`\`\`\n`
        : "",
      number % 12 === 0
        ? `\n行内公式 $x_${number}^2 + y^2$，展示公式：\n\n$$\\sum_{i=1}^{${number}} i = \\frac{n(n+1)}{2}$$\n`
        : "",
    ].join("");
    return `## 压力测试段落 ${number}\n\n这是用于验证长对话流式渲染的模拟正文。内容会持续增长，以检查 Markdown 分块、自动滚动、消息导航和上下文统计是否保持响应。当前段落编号为 **${number}**。\n\n- 保持已完成区块稳定，不重复解析。\n- 合并高频文本增量，限制 React 提交频率。\n- 在用户向上滚动后停止自动贴底。\n- 中文、English、\`inline code\` 与 [本地预览](http://localhost:3000) 混合出现。\n${extras}`;
  });
  return [
    "# 长文本流式回复压力测试",
    "",
    `本回复包含 ${sectionCount} 个 Markdown 段落，由 Chat Server 本地生成，不会调用模型或产生 token 用量。`,
    "",
    ...sections,
    "## 测试完成",
    "",
    "长文本已经全部输出。关闭开发设置中的开关即可恢复真实模型回复。",
  ].join("\n");
}

export function splitMockLongResponse(text: string, chunkSize = MOCK_CHUNK_SIZE) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += chunkSize) {
    chunks.push(text.slice(index, index + chunkSize));
  }
  return chunks;
}

type MockLongResponseOptions = {
  messages: UIMessage[];
  messageId: string;
  signal?: AbortSignal;
  delayMs?: number;
  onFinish: (messages: UIMessage[]) => Promise<void> | void;
};

export function createMockLongResponseStream(options: MockLongResponseOptions) {
  const { messages, messageId, signal, onFinish } = options;
  const delayMs = options.delayMs ?? MOCK_CHUNK_DELAY_MS;
  const text = buildMockLongResponse();
  return createUIMessageStream<UIMessage>({
    originalMessages: messages,
    generateId: () => messageId,
    execute: async ({ writer }) => {
      writer.write({ type: "start", messageId });
      writer.write({ type: "text-start", id: messageId });
      for (const chunk of splitMockLongResponse(text)) {
        if (signal?.aborted) {
          writer.write({ type: "abort", reason: "Mock response stopped" });
          return;
        }
        writer.write({ type: "text-delta", id: messageId, delta: chunk });
        if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      writer.write({ type: "text-end", id: messageId });
      writer.write({ type: "finish", finishReason: "stop" });
    },
    onEnd: ({ messages: completedMessages }) => onFinish(completedMessages),
  });
}

export function createMockLongResponse(options: MockLongResponseOptions) {
  const stream = createMockLongResponseStream(options);
  return createUIMessageStreamResponse({ stream });
}
