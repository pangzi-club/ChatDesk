import { isToolUIPart, type UIMessage } from "ai";
import type { ChatRunOutcome } from "./protocol.ts";

export const SKILL_SUGGESTION_TEXT =
  "要不要把这次对话中的流程整理成一个可复用的 Skill？回复“可以”，我就帮你创建。";

function metadata(message: UIMessage): Record<string, unknown> {
  return message.metadata && typeof message.metadata === "object"
    ? (message.metadata as Record<string, unknown>)
    : {};
}

export function hasSkillSuggestion(messages: UIMessage[]) {
  return messages.some(
    (message) => message.role === "assistant" && metadata(message).skillSuggestion === true,
  );
}

export function skillSuggestionInstructions(messages: UIMessage[]) {
  if (!hasSkillSuggestion(messages)) return "";
  return "此前已向用户询问是否将当前对话整理成 Skill，不要重复提醒。结合对话上下文理解用户意图：若用户明确同意该提议（例如回复‘可以’或‘好的’），先用 read_skill 读取 builtin:skill-creator，再按其流程创建本机 Skill；用户拒绝、另起话题或意图不明确时，不要自行创建。遵守当前计划模式和文件写入权限，不要把对其他问题的肯定回答当作创建授权。";
}

export function countConversationToolCalls(messages: UIMessage[]) {
  const summaries = new Map<string, number>();
  const coveredCalls = new Set<string>();
  const legacyCalls = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    const summary = metadata(message).runSummary as
      | { runId?: unknown; toolCallCount?: unknown }
      | undefined;
    const hasSummary =
      typeof summary?.runId === "string" &&
      typeof summary.toolCallCount === "number" &&
      Number.isSafeInteger(summary.toolCallCount) &&
      summary.toolCallCount >= 0;
    if (hasSummary) {
      summaries.set(
        summary.runId as string,
        Math.max(summaries.get(summary.runId as string) ?? 0, summary.toolCallCount as number),
      );
    }
    for (const part of message.parts) {
      if (isToolUIPart(part)) {
        (hasSummary ? coveredCalls : legacyCalls).add(part.toolCallId);
      }
    }
  }
  return (
    [...summaries.values()].reduce((total, count) => total + count, 0) +
    [...legacyCalls].filter((id) => !coveredCalls.has(id)).length
  );
}

export function appendSkillSuggestion(messages: UIMessage[], outcome: ChatRunOutcome): UIMessage[] {
  if (
    outcome !== "completed" ||
    hasSkillSuggestion(messages) ||
    countConversationToolCalls(messages) <= 10
  ) {
    return messages;
  }
  const last = messages.at(-1);
  if (
    last?.role !== "assistant" ||
    !last.parts.some((part) => part.type === "text" && part.text.trim())
  ) {
    return messages;
  }
  return [
    ...messages.slice(0, -1),
    {
      ...last,
      parts: [...last.parts, { type: "text", text: `\n\n${SKILL_SUGGESTION_TEXT}` }],
      metadata: { ...metadata(last), skillSuggestion: true },
    },
  ];
}
