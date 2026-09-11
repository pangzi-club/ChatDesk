/**
 * Prompt building and response parsing for the Chat Server long-term memory
 * operations (fact extraction and compaction).
 *
 * These prompts belong to the Chat Server rather than the desktop renderer:
 * every model invocation must be recorded through `AiUsageLogStore`, and the
 * server is the only place that owns both the model configuration and the
 * usage log.
 */

export const MEMORY_COMPACT_TARGET_ITEMS = 30;

export const MEMORY_EXTRACT_SYSTEM = `你是用户长期记忆抽取器。根据本轮对话，只抽取值得跨会话长期保留的稳定事实（身份、偏好、项目背景、固定约束等）。
规则：
1. 一条一事，尽量短，使用中文陈述句
2. 不要抽取临时任务、一次性请求、模型回复内容本身
3. 若没有值得记忆的内容，返回空数组 []
4. 只输出 JSON 字符串数组，不要 markdown，不要解释`;

export const MEMORY_COMPACT_SYSTEM = `你是用户长期记忆整理器。将给定记忆条目去重、合并矛盾（以更新/更具体者为准）、删除临时或无价值信息，输出更精炼的事实列表。
规则：
1. 保留稳定、可跨会话复用的事实
2. 一条一事，尽量短
3. 目标约 ${MEMORY_COMPACT_TARGET_ITEMS} 条以内
4. 只输出 JSON 字符串数组，不要 markdown，不要解释`;

export function formatMemoryItemsForPrompt(items: readonly string[]) {
  const lines = items.map((item) => `- ${item.trim()}`).filter((line) => line.length > 2);
  return lines.length === 0 ? "(空)" : lines.join("\n");
}

export function buildMemoryExtractPrompt(input: {
  items: readonly string[];
  workspacePath?: string;
  userText: string;
  assistantText: string;
}) {
  return [
    "已有记忆：",
    formatMemoryItemsForPrompt(input.items),
    "",
    `当前会话 workspace：${input.workspacePath || "未选择"}`,
    "注意：workspace 路径、当前工作目录、文件工具根目录都只是本轮会话上下文，绝对不要抽取为长期记忆。",
    "",
    "用户：",
    input.userText,
    "",
    "助手：",
    input.assistantText,
    "",
    "只返回尚未存在于已有记忆中的新事实；如果已有记忆需要更新，请返回更新后的完整事实，不要同时保留旧表述。",
  ].join("\n");
}

export function buildMemoryCompactPrompt(items: readonly string[]) {
  return `现有记忆：\n${formatMemoryItemsForPrompt(items)}`;
}

/** Parses the model's JSON string array, tolerating fenced or chatty output. */
export function parseMemoryFacts(text: string): string[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as { content?: unknown }).content === "string"
        ) {
          return (entry as { content: string }).content.trim();
        }
        return "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}
