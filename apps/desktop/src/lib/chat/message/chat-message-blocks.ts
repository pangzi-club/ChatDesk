import { CREATE_TASK_TOOL_NAME } from "@chatdesk/shared";
import { getToolName, isToolUIPart, type UIMessage } from "ai";

export type ChatToolPart = Extract<UIMessage["parts"][number], { toolCallId: string }>;
export type ChatSourcePart = Extract<
  UIMessage["parts"][number],
  { type: "source-url" | "source-document" }
>;
export type ChatFilePart = Extract<UIMessage["parts"][number], { type: "file" | "reasoning-file" }>;

export type ChatMessageBlock =
  | { kind: "text"; key: string; text: string }
  | { kind: "reasoning"; key: string; text: string }
  | { kind: "tools"; key: string; parts: ChatToolPart[] }
  | { kind: "tasks"; key: string; parts: ChatToolPart[] }
  | { kind: "sources"; key: string; parts: ChatSourcePart[] }
  | { kind: "files"; key: string; parts: ChatFilePart[] };

function appendTextBlock(blocks: ChatMessageBlock[], kind: "text" | "reasoning", text: string) {
  if (!text.trim()) return;
  const previous = blocks[blocks.length - 1];
  if (previous?.kind === kind) {
    previous.text += text;
    return;
  }
  blocks.push({ kind, key: `${kind}-${blocks.length}`, text });
}

export function getChatMessageBlocks(message: UIMessage): ChatMessageBlock[] {
  const blocks: ChatMessageBlock[] = [];

  for (const part of message.parts) {
    if (isToolUIPart(part)) {
      const kind = getToolName(part) === CREATE_TASK_TOOL_NAME ? "tasks" : "tools";
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === kind) previous.parts.push(part);
      else blocks.push({ kind, key: `${kind}-${blocks.length}`, parts: [part] });
    } else if (part.type === "text") {
      appendTextBlock(blocks, "text", part.text);
    } else if (part.type === "reasoning") {
      appendTextBlock(blocks, "reasoning", part.text);
    } else if (part.type === "source-url" || part.type === "source-document") {
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === "sources") previous.parts.push(part);
      else blocks.push({ kind: "sources", key: `sources-${blocks.length}`, parts: [part] });
    } else if (part.type === "file" || part.type === "reasoning-file") {
      const previous = blocks[blocks.length - 1];
      if (previous?.kind === "files") previous.parts.push(part);
      else blocks.push({ kind: "files", key: `files-${blocks.length}`, parts: [part] });
    }
  }

  return blocks;
}
