import type { UIMessage } from "ai";

export function mergeLiveDraft(messages: UIMessage[], draft: UIMessage | undefined) {
  if (!draft?.id || draft.parts.length === 0) return messages;
  const existingIndex = messages.findIndex((message) => message.id === draft.id);
  if (existingIndex < 0) return [...messages, draft];
  return messages.map((message, index) => (index === existingIndex ? draft : message));
}

export function appendLiveDraftText(
  draft: UIMessage | undefined,
  messageId: string,
  delta: string,
) {
  const current: UIMessage =
    draft?.id === messageId ? draft : { id: messageId, role: "assistant", parts: [] };
  const parts = [...current.parts];
  const lastPart = parts[parts.length - 1];
  if (lastPart?.type === "text" && lastPart.state !== "done") {
    parts[parts.length - 1] = { ...lastPart, text: `${lastPart.text}${delta}` };
  } else {
    parts.push({ type: "text", text: delta, state: "streaming" });
  }
  return { ...current, parts };
}
