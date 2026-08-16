import { Check, Copy, Sparkles } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

type ConversationMenuItemProps = {
  disabled?: boolean;
  onSelect?: () => void;
  children?: ReactNode;
};

type ChatConversationMenuItemsProps = {
  Item: ComponentType<ConversationMenuItemProps>;
  canRegenerateTitle: boolean;
  conversationIdCopied: boolean;
  onCopyConversationId: () => void;
  onRegenerateTitle: () => void;
};

export function ChatConversationMenuItems({
  Item,
  canRegenerateTitle,
  conversationIdCopied,
  onCopyConversationId,
  onRegenerateTitle,
}: ChatConversationMenuItemsProps) {
  return (
    <>
      <Item disabled={!canRegenerateTitle} onSelect={onRegenerateTitle}>
        <Sparkles className="size-4" />
        重新生成标题
      </Item>
      <Item onSelect={onCopyConversationId}>
        {conversationIdCopied ? (
          <Check className="size-4 text-primary" />
        ) : (
          <Copy className="size-4" />
        )}
        {conversationIdCopied ? "已复制对话 ID" : "复制对话 ID"}
      </Item>
    </>
  );
}

export async function copyChatConversationId(sessionId: string) {
  if (!navigator.clipboard) return false;
  try {
    await navigator.clipboard.writeText(sessionId);
    return true;
  } catch {
    return false;
  }
}
