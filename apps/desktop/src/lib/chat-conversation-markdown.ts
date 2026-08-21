import type { UIMessage } from "ai";

type ConversationMessage = Pick<UIMessage, "role" | "parts">;

const ROLE_HEADINGS: Record<"user" | "assistant", string> = {
  user: "用户",
  assistant: "助手",
};

export function chatMessageText(message: Pick<UIMessage, "parts">) {
  return message.parts
    .filter(
      (part): part is Extract<UIMessage["parts"][number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

export function canFormatChatConversationMarkdown(messages: ConversationMessage[]) {
  return messages.some(
    (message) =>
      (message.role === "user" || message.role === "assistant") &&
      Boolean(chatMessageText(message).trim()),
  );
}

export function formatChatConversationMarkdown(options: {
  title: string;
  messages: ConversationMessage[];
}) {
  const title = options.title.replace(/\s+/g, " ").trim() || "未命名对话";
  const sections = [`# ${title}`];

  for (const message of options.messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const text = chatMessageText(message).trim();
    if (!text) continue;
    sections.push(`## ${ROLE_HEADINGS[message.role]}\n\n${text}`);
  }

  return sections.join("\n\n");
}

export async function copyChatConversationMarkdown(options: {
  title: string;
  messages: ConversationMessage[];
}) {
  if (!navigator.clipboard || !canFormatChatConversationMarkdown(options.messages)) {
    return false;
  }
  try {
    await navigator.clipboard.writeText(formatChatConversationMarkdown(options));
    return true;
  } catch {
    return false;
  }
}
