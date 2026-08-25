import { Check, Copy, FileText, Pencil } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

type ConversationMenuItemProps = {
  disabled?: boolean;
  onSelect?: () => void;
  children?: ReactNode;
};

type ChatConversationMenuItemsProps = {
  Item: ComponentType<ConversationMenuItemProps>;
  canCopyAsMarkdown: boolean;
  canRegenerateTitle: boolean;
  conversationIdCopied: boolean;
  conversationMarkdownCopied: boolean;
  onCopyAsMarkdown: () => void;
  onCopyConversationId: () => void;
  onRegenerateTitle: () => void;
};

export function ChatConversationMenuItems({
  Item,
  canCopyAsMarkdown,
  canRegenerateTitle,
  conversationIdCopied,
  conversationMarkdownCopied,
  onCopyAsMarkdown,
  onCopyConversationId,
  onRegenerateTitle,
}: ChatConversationMenuItemsProps) {
  return (
    <>
      <Item onSelect={onCopyConversationId}>
        {conversationIdCopied ? (
          <Check className="size-4 text-primary" />
        ) : (
          <Copy className="size-4" />
        )}
        {conversationIdCopied ? "已复制对话 ID" : "复制对话 ID"}
      </Item>
      <Item disabled={!canCopyAsMarkdown} onSelect={onCopyAsMarkdown}>
        {conversationMarkdownCopied ? (
          <Check className="size-4 text-primary" />
        ) : (
          <FileText className="size-4" />
        )}
        {conversationMarkdownCopied ? "已复制为 Markdown" : "复制为 Markdown"}
      </Item>
      <Item disabled={!canRegenerateTitle} onSelect={onRegenerateTitle}>
        <Pencil className="size-4" />
        编辑标题
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
