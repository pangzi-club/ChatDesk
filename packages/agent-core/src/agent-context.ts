import { estimateTokenCount } from "@chatdesk/shared";
import { type ModelMessage, pruneMessages } from "ai";

export const CHECKPOINT_OUTPUT_TOKENS = 4_000;
export const RECENT_MODEL_MESSAGE_COUNT = 6;

const CHECKPOINT_INSTRUCTIONS = `Create a factual checkpoint for another agent continuing this run.
Use exactly these headings: Goal, User constraints, Confirmed facts and sources, Files and queries checked, Decisions made, Open questions, Next step.
Do not invent facts. Do not include hidden reasoning. Keep concrete file paths, identifiers, limits, and error details that affect the work.`;

function visibleValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter(
        (item) =>
          !item || typeof item !== "object" || (item as { type?: unknown }).type !== "reasoning",
      )
      .map(visibleValue);
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !["providerMetadata", "providerOptions", "reasoning"].includes(key))
      .map(([key, item]) => [key, visibleValue(item)]),
  );
}

export function visibleCheckpointMessages(messages: ModelMessage[]) {
  return visibleValue(messages) as ModelMessage[];
}

export function buildCheckpointPrompt(options: {
  messages: ModelMessage[];
  existingCheckpoint?: string;
  planContent?: string;
}) {
  const sections = [
    options.existingCheckpoint?.trim()
      ? `Existing checkpoint:\n${options.existingCheckpoint.trim()}`
      : undefined,
    `Visible conversation and tool evidence:\n${JSON.stringify(
      visibleCheckpointMessages(options.messages),
    )}`,
    options.planContent?.trim()
      ? `Current plan, included verbatim as authoritative state:\n${options.planContent}`
      : undefined,
  ].filter(Boolean);
  return `${CHECKPOINT_INSTRUCTIONS}\n\n${sections.join("\n\n")}`;
}

export function retainRecentModelMessages(messages: ModelMessage[]) {
  const pruned = pruneMessages({
    messages,
    reasoning: "all",
    toolCalls: "before-last-3-messages",
    emptyMessages: "remove",
  });
  if (pruned.length <= RECENT_MODEL_MESSAGE_COUNT) return pruned;
  let start = pruned.length - RECENT_MODEL_MESSAGE_COUNT;
  while (start > 0 && pruned[start]?.role === "tool") start -= 1;
  return pruned.slice(start);
}

export function checkpointInstructions(options: {
  base: string;
  checkpoint: string;
  planContent?: string;
  policyInstructions?: string;
}) {
  return [
    options.base,
    `<agent-checkpoint>\n${options.checkpoint}\n</agent-checkpoint>`,
    options.planContent?.trim()
      ? `<current-plan-verbatim>\n${options.planContent}\n</current-plan-verbatim>`
      : undefined,
    options.policyInstructions,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function estimateAgentContextTokens(messages: ModelMessage[], instructions: string) {
  return estimateTokenCount(JSON.stringify(messages) + instructions);
}
