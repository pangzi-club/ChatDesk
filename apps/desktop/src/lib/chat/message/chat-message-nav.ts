import { textFromMessage } from "@chatdesk/shared";
import type { UIMessage } from "ai";

export const CHAT_MESSAGE_NAV_TITLE_CHARS = 32;
export const CHAT_MESSAGE_NAV_MIN_WIDTH = 720;
export const CHAT_MESSAGE_NAV_ATTACHMENT_TITLE = "附件";

export type UserMessageNavItem = {
  id: string;
  title: string;
  snippet: string;
};

function truncateChars(value: string, maxChars: number) {
  const chars = Array.from(value);
  if (chars.length <= maxChars) return value;
  return `${chars.slice(0, maxChars).join("")}…`;
}

function hasFilePart(message: Pick<UIMessage, "parts">) {
  return message.parts.some((part) => part.type === "file" || part.type === "reasoning-file");
}

export function buildUserMessageNavItem(
  message: Pick<UIMessage, "id" | "parts">,
): UserMessageNavItem {
  const text = textFromMessage(message as UIMessage)
    .replace(/\r\n/g, "\n")
    .trim();
  if (!text) {
    return { id: message.id, title: CHAT_MESSAGE_NAV_ATTACHMENT_TITLE, snippet: "" };
  }

  const newlineIndex = text.search(/\n/);
  if (newlineIndex === -1) {
    return {
      id: message.id,
      snippet: text,
      title: truncateChars(text, CHAT_MESSAGE_NAV_TITLE_CHARS),
    };
  }

  const firstLine = text.slice(0, newlineIndex).trim() || "用户消息";
  const rest = text
    .slice(newlineIndex + 1)
    .replace(/\s+/g, " ")
    .trim();
  return {
    id: message.id,
    snippet: rest || firstLine,
    title: truncateChars(firstLine, CHAT_MESSAGE_NAV_TITLE_CHARS),
  };
}

export function listUserMessageNavItems(messages: UIMessage[]): UserMessageNavItem[] {
  return messages
    .filter((message) => {
      if (message.role !== "user") return false;
      return Boolean(textFromMessage(message).trim()) || hasFilePart(message);
    })
    .map(buildUserMessageNavItem);
}

export function createUserMessageNavItemsSelector() {
  let previousMessages: UIMessage[] = [];
  let previousItems: UserMessageNavItem[] = [];

  return (messages: UIMessage[]) => {
    const userMessages = messages.filter((message) => message.role === "user");
    if (
      userMessages.length === previousMessages.length &&
      userMessages.every((message, index) => message === previousMessages[index])
    ) {
      return previousItems;
    }
    previousMessages = userMessages;
    previousItems = listUserMessageNavItems(userMessages);
    return previousItems;
  };
}

export function resolveActiveUserMessageId(
  items: Pick<UserMessageNavItem, "id">[],
  getTop: (id: string) => number | null,
  viewportTop: number,
): string | null {
  if (items.length === 0) return null;
  let activeId = items[0]?.id ?? null;
  for (const item of items) {
    const top = getTop(item.id);
    if (top === null) continue;
    if (top <= viewportTop) activeId = item.id;
    else break;
  }
  return activeId;
}
