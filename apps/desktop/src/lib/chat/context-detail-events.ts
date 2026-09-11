import type { RunStartInput, SystemPromptSnapshot } from "@chatdesk/shared";
import type { UIMessage } from "ai";
import { createWindowEventBus } from "@/lib/runtime/window-event-bus";

export type ContextDetailPromptInput = Pick<
  RunStartInput,
  "system" | "memory" | "cwd" | "workspaceId" | "toolNames"
>;

export type ContextDetailOpenRequest = {
  sessionId: string;
  messages: UIMessage[];
  promptInput: ContextDetailPromptInput;
  systemPrompt?: SystemPromptSnapshot;
};

export type ContextDetailUpdateRequest = {
  sessionId: string;
  messages?: UIMessage[];
  promptInput?: ContextDetailPromptInput;
  systemPrompt?: SystemPromptSnapshot;
};

const contextDetailOpenBus = createWindowEventBus<ContextDetailOpenRequest>(
  "chatdesk:context-detail-open",
);
const contextDetailUpdatedBus = createWindowEventBus<ContextDetailUpdateRequest>(
  "chatdesk:context-detail-updated",
);

export function openContextDetail(request: ContextDetailOpenRequest) {
  contextDetailOpenBus.dispatch(request);
}

export function updateContextDetail(request: ContextDetailUpdateRequest) {
  contextDetailUpdatedBus.dispatch(request);
}

export function subscribeContextDetailOpen(listener: (request: ContextDetailOpenRequest) => void) {
  return contextDetailOpenBus.subscribe(listener);
}

export function subscribeContextDetailUpdated(
  listener: (request: ContextDetailUpdateRequest) => void,
) {
  return contextDetailUpdatedBus.subscribe(listener);
}
