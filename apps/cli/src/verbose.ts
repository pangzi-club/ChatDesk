import type { ChatRunSummary, ChatTokenUsage } from "@chatdesk/shared";

export type VerboseTurn = {
  modelLabel: string;
  summary?: ChatRunSummary;
  usage?: ChatTokenUsage;
};

function formatDuration(durationMs: number) {
  if (!Number.isFinite(durationMs) || durationMs < 0) return undefined;
  if (durationMs < 1000) return `${Math.round(durationMs)} 毫秒`;
  const seconds = durationMs / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} 秒`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest > 0 ? `${minutes} 分 ${rest} 秒` : `${minutes} 分`;
}

export function formatVerboseSummary(turn: VerboseTurn) {
  const lines = [`模型: ${turn.modelLabel}`];
  const summary = turn.summary;
  if (summary) {
    lines.push(`结果: ${summary.outcome}`);
    if (summary.stopReason) lines.push(`停止原因: ${summary.stopReason}`);
    const duration =
      typeof summary.durationMs === "number" ? formatDuration(summary.durationMs) : undefined;
    if (duration) lines.push(`用时: ${duration}`);
    lines.push(
      `步数: ${summary.stepCount}  模型调用: ${summary.modelCallCount}  工具调用: ${summary.toolCallCount}`,
    );
    lines.push(
      `失败工具: ${summary.failedToolCallCount ?? 0}  上下文压缩: ${summary.compactionCount}`,
    );
    if (summary.touchedPaths?.length) lines.push(`修改文件: ${summary.touchedPaths.join(", ")}`);
  }
  const usage = turn.usage;
  if (usage) {
    const tokens: string[] = [];
    if (typeof usage.inputTokens === "number") tokens.push(`输入 ${usage.inputTokens}`);
    if (typeof usage.outputTokens === "number") tokens.push(`输出 ${usage.outputTokens}`);
    if (typeof usage.cacheReadTokens === "number") tokens.push(`缓存 ${usage.cacheReadTokens}`);
    if (typeof usage.reasoningOutputTokens === "number") {
      tokens.push(`推理 ${usage.reasoningOutputTokens}`);
    }
    if (tokens.length > 0) lines.push(`token: ${tokens.join("  ")}`);
  }
  return lines.join("\n");
}
