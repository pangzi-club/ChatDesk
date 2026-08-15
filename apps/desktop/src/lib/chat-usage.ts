import type { ChatContextCompaction, ChatContextUsage, ChatRunSummary } from "@chatdesk/shared";
import { isToolUIPart, type UIMessage } from "ai";

import {
  type ArchiveSession,
  type ArchiveSource,
  type ArchiveTokenUsage,
  loadArchiveIndex,
  loadArchiveSession,
  sourceLabel,
} from "@/lib/chat-archive";
import { loadChatIndex, loadChatSession } from "@/lib/chat-store";

export type TokenUsage = ArchiveTokenUsage;

export type ChatMessageMetadata = {
  usage?: TokenUsage;
  contextUsage?: ChatContextUsage;
  contextCompaction?: ChatContextCompaction;
  runSummary?: ChatRunSummary;
  toolLimitReached?: boolean;
  stopReason?: "tool-limit";
};

export type UsageCategoryKey =
  | "inputTokens"
  | "outputTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "reasoningOutputTokens";

export type UsageCategory = {
  key: UsageCategoryKey;
  label: string;
  tokens: number;
  percent: number;
};

export type SourceUsageBreakdown = {
  source: ArchiveSource;
  label: string;
  sessionCount: number;
  sessionsWithUsage: number;
  messageCount: number;
  usage: TokenUsage;
  categories: UsageCategory[];
};

export type HistoryUsageAnalysis = {
  sessionCount: number;
  sessionsWithUsage: number;
  messageCount: number;
  usage: TokenUsage;
  categories: UsageCategory[];
  bySource: SourceUsageBreakdown[];
};

const CATEGORY_META: Array<{ key: UsageCategoryKey; label: string }> = [
  { key: "inputTokens", label: "输入" },
  { key: "outputTokens", label: "输出" },
  { key: "cacheReadTokens", label: "缓存读取" },
  { key: "cacheWriteTokens", label: "缓存写入" },
  { key: "reasoningOutputTokens", label: "推理输出" },
];

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function emptyTokenUsage(): TokenUsage {
  return {};
}

export function hasTokenUsage(usage?: TokenUsage | null): boolean {
  if (!usage) return false;
  return (
    CATEGORY_META.some(({ key }) => typeof usage[key] === "number") ||
    typeof usage.totalTokens === "number"
  );
}

export function addTokenUsage(left: TokenUsage, right?: TokenUsage | null): TokenUsage {
  if (!right || !hasTokenUsage(right)) return { ...left };
  const next: TokenUsage = { ...left };
  for (const { key } of CATEGORY_META) {
    const value = right[key];
    if (typeof value === "number") {
      next[key] = (next[key] ?? 0) + value;
    }
  }
  if (typeof right.totalTokens === "number") {
    next.totalTokens = (next.totalTokens ?? 0) + right.totalTokens;
  }
  return next;
}

export function sumTokenUsages(usages: Array<TokenUsage | undefined | null>): TokenUsage {
  return usages.reduce<TokenUsage>((acc, usage) => addTokenUsage(acc, usage), emptyTokenUsage());
}

export function normalizeTokenUsage(value: {
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  reasoningOutputTokens?: number | null;
  prompt_tokens?: number | null;
  completion_tokens?: number | null;
  total_tokens?: number | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cached_input_tokens?: number | null;
  cached_tokens?: number | null;
  cache_write_input_tokens?: number | null;
  reasoning_output_tokens?: number | null;
}): TokenUsage | undefined {
  const inputTokens =
    asFiniteNumber(value.inputTokens) ??
    asFiniteNumber(value.input_tokens) ??
    asFiniteNumber(value.prompt_tokens);
  const outputTokens =
    asFiniteNumber(value.outputTokens) ??
    asFiniteNumber(value.output_tokens) ??
    asFiniteNumber(value.completion_tokens);
  const totalTokens = asFiniteNumber(value.totalTokens) ?? asFiniteNumber(value.total_tokens);
  const cacheReadTokens =
    asFiniteNumber(value.cacheReadTokens) ??
    asFiniteNumber(value.cache_read_input_tokens) ??
    asFiniteNumber(value.cached_input_tokens) ??
    asFiniteNumber(value.cached_tokens);
  const cacheWriteTokens =
    asFiniteNumber(value.cacheWriteTokens) ??
    asFiniteNumber(value.cache_creation_input_tokens) ??
    asFiniteNumber(value.cache_write_input_tokens);
  const reasoningOutputTokens =
    asFiniteNumber(value.reasoningOutputTokens) ?? asFiniteNumber(value.reasoning_output_tokens);

  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens,
    cacheReadTokens,
    cacheWriteTokens,
    reasoningOutputTokens,
  };
  return hasTokenUsage(usage) ? usage : undefined;
}

export function getMessageUsage(message: UIMessage): TokenUsage | undefined {
  const metadata = message.metadata as ChatMessageMetadata | undefined;
  const usage = metadata?.usage;
  if (!usage || typeof usage !== "object") return undefined;
  return hasTokenUsage(usage) ? usage : undefined;
}

export function getMessageContextUsage(message: UIMessage): ChatContextUsage | undefined {
  const metadata = message.metadata as ChatMessageMetadata | undefined;
  const contextUsage = metadata?.contextUsage;
  if (
    contextUsage &&
    typeof contextUsage.inputTokens === "number" &&
    Number.isFinite(contextUsage.inputTokens)
  ) {
    return contextUsage;
  }
  const compaction = metadata?.contextCompaction;
  if (
    !compaction ||
    typeof compaction.estimatedTokensAfter !== "number" ||
    !Number.isFinite(compaction.estimatedTokensAfter)
  ) {
    return undefined;
  }
  return {
    inputTokens: compaction.estimatedTokensAfter,
    source: "estimate",
    stepNumber: compaction.stepNumber,
  };
}

export function getMessageRunStateLabel(message: UIMessage) {
  if (message.role !== "assistant") return undefined;
  const summary = (message.metadata as ChatMessageMetadata | undefined)?.runSummary;
  if (summary?.outcome === "completed") return "已完成";
  if (summary?.outcome === "awaiting-user") return "等待你的回复";
  if (summary?.outcome === "stopped") return "已停止";
  if (summary?.outcome === "error") return "未完整结束";
  const hasText = message.parts.some((part) => part.type === "text" && part.text.trim());
  return !hasText && message.parts.some(isToolUIPart) ? "未完整结束" : "已完成";
}

export function getMessageRunErrorLabel(message: UIMessage) {
  if (message.role !== "assistant") return undefined;
  const summary = (message.metadata as ChatMessageMetadata | undefined)?.runSummary;
  if (summary?.outcome !== "error") return undefined;
  switch (summary.stopReason) {
    case "tool-loop":
      return "检测到重复工具循环，运行已停止。";
    case "step-limit":
      return "已达到运行步数上限，任务未完整结束。";
    case "checkpoint-failed":
      return "上下文检查点生成失败，运行已停止。";
    case "context-limit":
      return "模型上下文或输出长度达到限制，运行未完整结束。";
    case "server-restarted":
      return "Chat Server 重启中断了本次运行。";
    default:
      return "模型没有返回可用的最终回复。";
  }
}

export function formatTokenUsage(usage: TokenUsage) {
  const parts: string[] = [];
  if (typeof usage.inputTokens === "number") {
    parts.push(`输入 ${usage.inputTokens.toLocaleString("zh-CN")}`);
  }
  if (typeof usage.outputTokens === "number") {
    parts.push(`输出 ${usage.outputTokens.toLocaleString("zh-CN")}`);
  }
  if (typeof usage.cacheReadTokens === "number") {
    parts.push(`缓存读 ${usage.cacheReadTokens.toLocaleString("zh-CN")}`);
  }
  if (typeof usage.cacheWriteTokens === "number") {
    parts.push(`缓存写 ${usage.cacheWriteTokens.toLocaleString("zh-CN")}`);
  }
  if (typeof usage.reasoningOutputTokens === "number") {
    parts.push(`推理 ${usage.reasoningOutputTokens.toLocaleString("zh-CN")}`);
  }
  if (typeof usage.totalTokens === "number") {
    parts.push(`合计 ${usage.totalTokens.toLocaleString("zh-CN")}`);
  }
  return parts.join(" · ");
}

export function buildUsageCategories(usage: TokenUsage): UsageCategory[] {
  const rows = CATEGORY_META.map(({ key, label }) => ({
    key,
    label,
    tokens: typeof usage[key] === "number" ? (usage[key] as number) : 0,
  })).filter((row) => row.tokens > 0);
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  return rows.map((row) => ({
    ...row,
    percent: total > 0 ? (row.tokens / total) * 100 : 0,
  }));
}

function sessionUsageFromArchive(session: ArchiveSession): TokenUsage {
  if (hasTokenUsage(session.usageTotal)) return session.usageTotal ?? emptyTokenUsage();
  return sumTokenUsages(session.messages.map((message) => message.usage));
}

function sessionUsageFromNative(messages: UIMessage[]): TokenUsage {
  return sumTokenUsages(messages.map((message) => getMessageUsage(message)));
}

function makeSourceBreakdown(
  source: ArchiveSource,
  sessionCount: number,
  sessionsWithUsage: number,
  messageCount: number,
  usage: TokenUsage,
): SourceUsageBreakdown {
  return {
    source,
    label: sourceLabel(source),
    sessionCount,
    sessionsWithUsage,
    messageCount,
    usage,
    categories: buildUsageCategories(usage),
  };
}

export async function analyzeHistoryUsage(): Promise<HistoryUsageAnalysis> {
  const [nativeIndex, archiveIndex] = await Promise.all([loadChatIndex(), loadArchiveIndex()]);

  let sessionCount = 0;
  let sessionsWithUsage = 0;
  let messageCount = 0;
  let usage = emptyTokenUsage();

  const bySourceMap = new Map<
    ArchiveSource,
    {
      sessionCount: number;
      sessionsWithUsage: number;
      messageCount: number;
      usage: TokenUsage;
    }
  >();

  const bump = (source: ArchiveSource, nextMessageCount: number, nextUsage: TokenUsage) => {
    sessionCount += 1;
    messageCount += nextMessageCount;
    const withUsage = hasTokenUsage(nextUsage);
    if (withUsage) sessionsWithUsage += 1;
    usage = addTokenUsage(usage, nextUsage);

    const prev = bySourceMap.get(source) ?? {
      sessionCount: 0,
      sessionsWithUsage: 0,
      messageCount: 0,
      usage: emptyTokenUsage(),
    };
    bySourceMap.set(source, {
      sessionCount: prev.sessionCount + 1,
      sessionsWithUsage: prev.sessionsWithUsage + (withUsage ? 1 : 0),
      messageCount: prev.messageCount + nextMessageCount,
      usage: addTokenUsage(prev.usage, nextUsage),
    });
  };

  for (const item of nativeIndex) {
    const session = await loadChatSession(item.id);
    if (!session) continue;
    bump("native", session.messages.length, sessionUsageFromNative(session.messages));
  }

  for (const item of archiveIndex) {
    const session = await loadArchiveSession(item.id);
    if (!session) continue;
    bump(session.source, session.messages.length, sessionUsageFromArchive(session));
  }

  const sourceOrder: ArchiveSource[] = ["native", "codex", "claude-code", "cursor", "kimi"];
  const bySource = sourceOrder.flatMap((source) => {
    const entry = bySourceMap.get(source);
    if (!entry) return [];
    return [
      makeSourceBreakdown(
        source,
        entry.sessionCount,
        entry.sessionsWithUsage,
        entry.messageCount,
        entry.usage,
      ),
    ];
  });

  return {
    sessionCount,
    sessionsWithUsage,
    messageCount,
    usage,
    categories: buildUsageCategories(usage),
    bySource,
  };
}
