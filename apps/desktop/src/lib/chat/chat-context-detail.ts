import { estimateTokenCount } from "@chatdesk/shared";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

export type ContextDetailCategory = "system" | "user" | "assistant" | "tool";

export type ContextDetailSegment = {
  id: string;
  category: ContextDetailCategory;
  estimatedTokens: number;
  percent: number;
  preview: string;
  messageId?: string;
};

export type ContextDetailSummary = {
  category: ContextDetailCategory;
  estimatedTokens: number;
  percent: number;
};

export type ContextDetailAnalysis = {
  segments: ContextDetailSegment[];
  summaries: ContextDetailSummary[];
  totalEstimatedTokens: number;
};

type ContextDetailCachedSegment = Omit<ContextDetailSegment, "id" | "messageId" | "percent">;

export const CONTEXT_DETAIL_CATEGORIES: Array<{
  category: ContextDetailCategory;
  label: string;
}> = [
  { category: "system", label: "System" },
  { category: "user", label: "用户" },
  { category: "assistant", label: "助手" },
  { category: "tool", label: "工具" },
];

function visibleValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(visibleValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["providerMetadata", "providerOptions"].includes(key))
      .map(([key, item]) => [key, visibleValue(item)]),
  );
}

function compactPreview(value: string) {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 80 ? `${compact.slice(0, 79)}…` : compact;
}

function partPreview(part: UIMessage["parts"][number]) {
  if ((part.type === "text" || part.type === "reasoning") && "text" in part) {
    return typeof part.text === "string" ? part.text : "";
  }
  if (part.type === "file" || part.type === "reasoning-file") {
    const filename =
      "filename" in part && typeof part.filename === "string" ? part.filename : "附件";
    return `附件：${filename}`;
  }
  if (isToolUIPart(part)) return `工具：${getToolName(part)}`;
  return part.type;
}

function segmentPayload(parts: UIMessage["parts"]) {
  return JSON.stringify(visibleValue(parts));
}

function messageSegments(
  message: UIMessage,
  estimateTokens: (value: string) => number,
): ContextDetailCachedSegment[] {
  const target: ContextDetailCachedSegment[] = [];
  if (message.role === "user") {
    const payload = segmentPayload(message.parts);
    const estimatedTokens = estimateTokens(payload);
    if (estimatedTokens === 0) return target;
    target.push({
      category: "user",
      estimatedTokens,
      preview:
        compactPreview(message.parts.map(partPreview).filter(Boolean).join(" · ")) || "用户消息",
    });
    return target;
  }

  let runCategory: ContextDetailCategory | undefined;
  let runParts: UIMessage["parts"] = [];
  const flush = () => {
    if (!runCategory || runParts.length === 0) return;
    const estimatedTokens = estimateTokens(segmentPayload(runParts));
    if (estimatedTokens > 0) {
      target.push({
        category: runCategory,
        estimatedTokens,
        preview:
          compactPreview(runParts.map(partPreview).filter(Boolean).join(" · ")) ||
          (runCategory === "tool" ? "工具调用" : "助手消息"),
      });
    }
    runParts = [];
  };

  for (const part of message.parts) {
    const category: ContextDetailCategory = isToolUIPart(part) ? "tool" : "assistant";
    if (runCategory && category !== runCategory) flush();
    runCategory = category;
    runParts.push(part);
  }
  flush();
  return target;
}

export function createChatContextAnalyzer(
  estimateTokens: (value: string) => number = estimateTokenCount,
) {
  const messageCache = new WeakMap<UIMessage, ContextDetailCachedSegment[]>();
  let cachedSystemPrompt: string | undefined;
  let cachedSystemSegment: Omit<ContextDetailSegment, "percent"> | undefined;

  return (systemPrompt: string | undefined, messages: UIMessage[]): ContextDetailAnalysis => {
    const rawSegments: Omit<ContextDetailSegment, "percent">[] = [];
    if (systemPrompt?.trim()) {
      if (systemPrompt !== cachedSystemPrompt || !cachedSystemSegment) {
        cachedSystemPrompt = systemPrompt;
        cachedSystemSegment = {
          id: "system-prompt",
          category: "system",
          estimatedTokens: estimateTokens(systemPrompt),
          preview: compactPreview(systemPrompt),
        };
      }
      rawSegments.push(cachedSystemSegment);
    }
    for (const [messageIndex, message] of messages.entries()) {
      let cached = messageCache.get(message);
      if (!cached) {
        cached = messageSegments(message, estimateTokens);
        messageCache.set(message, cached);
      }
      cached.forEach((segment, segmentIndex) => {
        rawSegments.push({
          ...segment,
          id: `message-${messageIndex}-${segmentIndex}`,
          messageId: message.id,
        });
      });
    }
    const totalEstimatedTokens = rawSegments.reduce(
      (total, segment) => total + segment.estimatedTokens,
      0,
    );
    const segments = rawSegments.map((segment) => ({
      ...segment,
      percent:
        totalEstimatedTokens > 0 ? (segment.estimatedTokens / totalEstimatedTokens) * 100 : 0,
    }));
    const summaries = CONTEXT_DETAIL_CATEGORIES.map(({ category }) => {
      const estimatedTokens = segments
        .filter((segment) => segment.category === category)
        .reduce((total, segment) => total + segment.estimatedTokens, 0);
      return {
        category,
        estimatedTokens,
        percent: totalEstimatedTokens > 0 ? (estimatedTokens / totalEstimatedTokens) * 100 : 0,
      };
    }).filter((summary) => summary.estimatedTokens > 0);
    return { segments, summaries, totalEstimatedTokens };
  };
}

const defaultAnalyzer = createChatContextAnalyzer();

export function analyzeChatContext(systemPrompt: string | undefined, messages: UIMessage[]) {
  return defaultAnalyzer(systemPrompt, messages);
}
