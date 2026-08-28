import type { ContextCompactionStrategy } from "@chatdesk/shared";
import { estimateTokenCount } from "@chatdesk/shared";
import { type ModelMessage, pruneMessages } from "ai";

export const CHECKPOINT_OUTPUT_TOKENS = 4_000;
export const RECENT_MODEL_MESSAGE_COUNT = 6;
export const DEFAULT_CONTEXT_COMPACTION_WINDOW_MINUTES = 30;

export type ContextCompactionResult = {
  messages: ModelMessage[];
  checkpoint?: string;
  cutoffAt?: string;
  droppedMessageCount?: number;
};

export type ContextCompactionStrategyInput = {
  messages: ModelMessage[];
  now?: Date;
  windowMinutes?: number;
  getMessageCreatedAt?: (message: ModelMessage) => string | undefined;
  generateCheckpoint: () => Promise<string>;
};

export interface ContextCompactionStrategyHandler {
  readonly kind: ContextCompactionStrategy;
  compact(input: ContextCompactionStrategyInput): Promise<ContextCompactionResult>;
}

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

function normalizeWindowMinutes(value: number | undefined) {
  return Number.isFinite(value) && (value ?? 0) > 0
    ? Math.min(Math.floor(value as number), 7 * 24 * 60)
    : DEFAULT_CONTEXT_COMPACTION_WINDOW_MINUTES;
}

class SemanticCheckpointStrategy implements ContextCompactionStrategyHandler {
  readonly kind = "semantic-checkpoint" as const;

  async compact(input: ContextCompactionStrategyInput): Promise<ContextCompactionResult> {
    const checkpoint = (await input.generateCheckpoint()).trim();
    if (!checkpoint) throw new Error("模型返回了空检查点");
    return { messages: retainRecentModelMessages(input.messages), checkpoint };
  }
}

class RecentTimeStrategy implements ContextCompactionStrategyHandler {
  readonly kind = "recent-time" as const;

  async compact(input: ContextCompactionStrategyInput): Promise<ContextCompactionResult> {
    const now = input.now ?? new Date();
    const cutoff = new Date(now.getTime() - normalizeWindowMinutes(input.windowMinutes) * 60_000);
    const getCreatedAt = input.getMessageCreatedAt ?? (() => undefined);
    const initiallyKept = input.messages.filter((message) => {
      const value = getCreatedAt(message);
      if (!value) return true;
      const timestamp = Date.parse(value);
      return !Number.isFinite(timestamp) || timestamp >= cutoff.getTime();
    });
    const keptSet = new Set(initiallyKept);
    const toolIds = (message: ModelMessage) => {
      if (!Array.isArray(message.content)) return [];
      return message.content.flatMap((part) => {
        if (!part || typeof part !== "object") return [];
        const value = part as { type?: unknown; toolCallId?: unknown };
        return (value.type === "tool-call" || value.type === "tool-result") &&
          typeof value.toolCallId === "string"
          ? [value.toolCallId]
          : [];
      });
    };
    const requiredToolCallIds = new Set(initiallyKept.flatMap(toolIds));
    for (const message of input.messages) {
      if (!keptSet.has(message) && toolIds(message).some((id) => requiredToolCallIds.has(id))) {
        keptSet.add(message);
      }
    }
    const kept = input.messages.filter((message) => keptSet.has(message));
    return {
      messages: kept.length > 0 ? kept : input.messages.slice(-1),
      cutoffAt: cutoff.toISOString(),
      droppedMessageCount: input.messages.length - kept.length,
    };
  }
}

export function createContextCompactionStrategy(
  kind: ContextCompactionStrategy | undefined,
): ContextCompactionStrategyHandler {
  return kind === "recent-time" ? new RecentTimeStrategy() : new SemanticCheckpointStrategy();
}

export function checkpointInstructions(options: {
  base: string;
  checkpoint: string;
  planContent?: string;
  policyInstructions?: string;
}) {
  return [
    options.base,
    options.checkpoint.trim()
      ? `<agent-checkpoint>\n${options.checkpoint}\n</agent-checkpoint>`
      : undefined,
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
