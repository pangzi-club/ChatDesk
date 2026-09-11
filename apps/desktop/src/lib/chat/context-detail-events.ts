import type { RunStartInput, SystemPromptSnapshot } from "@chatdesk/shared";
import type { UIMessage } from "ai";

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

const OPEN_EVENT_NAME = "chatdesk:context-detail-open";
const UPDATE_EVENT_NAME = "chatdesk:context-detail-updated";

export function openContextDetail(request: ContextDetailOpenRequest) {
  window.dispatchEvent(
    new CustomEvent<ContextDetailOpenRequest>(OPEN_EVENT_NAME, { detail: request }),
  );
}

export function updateContextDetail(request: ContextDetailUpdateRequest) {
  window.dispatchEvent(
    new CustomEvent<ContextDetailUpdateRequest>(UPDATE_EVENT_NAME, { detail: request }),
  );
}

export function subscribeContextDetailOpen(listener: (request: ContextDetailOpenRequest) => void) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ContextDetailOpenRequest>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(OPEN_EVENT_NAME, handler);
  return () => window.removeEventListener(OPEN_EVENT_NAME, handler);
}

export function subscribeContextDetailUpdated(
  listener: (request: ContextDetailUpdateRequest) => void,
) {
  const handler = (event: Event) => {
    const detail = (event as CustomEvent<ContextDetailUpdateRequest>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(UPDATE_EVENT_NAME, handler);
  return () => window.removeEventListener(UPDATE_EVENT_NAME, handler);
}
