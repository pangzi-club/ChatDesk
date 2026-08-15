import {
  type ChatPlanMode,
  type ChatRunSummary,
  PLAN_USER_INPUT_TOOL_NAME,
} from "@chatdesk/shared";
import {
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithToolCalls,
  type UIMessage,
} from "ai";

export function findLatestPlanWriteContent(messages: UIMessage[]) {
  const message = messages[messages.length - 1];
  if (message?.role !== "assistant") return undefined;
  for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
    const part = message.parts[partIndex];
    if (!isToolUIPart(part) || getToolName(part) !== "plan_write" || !("input" in part)) continue;
    const input = part.input;
    if (
      input &&
      typeof input === "object" &&
      typeof (input as { content?: unknown }).content === "string"
    ) {
      return (input as { content: string }).content;
    }
  }
  return undefined;
}

export function latestAssistantHasPlanWrite(messages: UIMessage[]) {
  const message = messages[messages.length - 1];
  return Boolean(
    message?.role === "assistant" &&
      message.parts.some((part) => isToolUIPart(part) && getToolName(part) === "plan_write"),
  );
}

export function isPlanExecutionReady(
  planMode: ChatPlanMode,
  activePlanHasContent: boolean,
  runSummary?: ChatRunSummary,
) {
  return Boolean(
    planMode === "plan" &&
      activePlanHasContent &&
      runSummary?.outcome === "completed" &&
      runSummary.planWritten,
  );
}

export function lastAssistantMessageHasCompletedPlanInput(messages: UIMessage[]) {
  if (!lastAssistantMessageIsCompleteWithToolCalls({ messages })) return false;
  const message = messages[messages.length - 1];
  if (message?.role !== "assistant") return false;
  let lastStepStart = -1;
  for (let index = message.parts.length - 1; index >= 0; index -= 1) {
    if (message.parts[index].type === "step-start") {
      lastStepStart = index;
      break;
    }
  }
  return message.parts
    .slice(lastStepStart + 1)
    .some(
      (part) =>
        isToolUIPart(part) &&
        getToolName(part) === PLAN_USER_INPUT_TOOL_NAME &&
        part.state === "output-available",
    );
}
