import assert from "node:assert/strict";
import type { ChatRunSummary } from "@chatdesk/shared";
import { describe, it } from "vitest";
import { formatVerboseSummary } from "./verbose.ts";

const summary: ChatRunSummary = {
  runId: "run-1",
  outcome: "completed",
  stopReason: "user",
  stepCount: 4,
  modelCallCount: 3,
  toolCallCount: 2,
  duplicateToolCallCount: 0,
  compactionCount: 1,
  planWritten: false,
  failedToolCallCount: 1,
  touchedPaths: ["src/a.ts", "src/b.ts"],
  durationMs: 1500,
};

describe("formatVerboseSummary", () => {
  it("prints model, outcome, duration, counts, paths, and tokens when present", () => {
    const text = formatVerboseSummary({
      modelLabel: "mock-model",
      summary,
      usage: {
        inputTokens: 10,
        outputTokens: 3,
        cacheReadTokens: 2,
        reasoningOutputTokens: 1,
      },
    });
    assert.match(text, /模型: mock-model/);
    assert.match(text, /结果: completed/);
    assert.match(text, /停止原因: user/);
    assert.match(text, /用时: 1\.5 秒/);
    assert.match(text, /步数: 4 {2}模型调用: 3 {2}工具调用: 2/);
    assert.match(text, /失败工具: 1 {2}上下文压缩: 1/);
    assert.match(text, /修改文件: src\/a.ts, src\/b.ts/);
    assert.match(text, /token: 输入 10 {2}输出 3 {2}缓存 2 {2}推理 1/);
  });

  it("omits token and path lines when they are absent", () => {
    const text = formatVerboseSummary({
      modelLabel: "mock-model",
      summary: { ...summary, touchedPaths: [], stopReason: undefined, durationMs: undefined },
    });
    assert.doesNotMatch(text, /修改文件/);
    assert.doesNotMatch(text, /token:/);
    assert.doesNotMatch(text, /停止原因/);
    assert.doesNotMatch(text, /用时/);
  });
});
