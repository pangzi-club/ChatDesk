export const CHAT_USER_MESSAGE_COLLAPSE_CHARS = 800;
export const CHAT_USER_MESSAGE_COLLAPSE_LINES = 8;
export const CHAT_USER_MESSAGE_PREVIEW_CHARS = 360;
export const CHAT_USER_MESSAGE_PREVIEW_LINES = 5;

export function shouldCollapseChatUserMessage(text: string) {
  if (!text) return false;
  return (
    text.length > CHAT_USER_MESSAGE_COLLAPSE_CHARS ||
    text.split(/\r?\n/).length > CHAT_USER_MESSAGE_COLLAPSE_LINES
  );
}

export function previewCollapsedChatUserMessage(text: string) {
  const lines = text.split(/\r?\n/).slice(0, CHAT_USER_MESSAGE_PREVIEW_LINES);
  let preview = lines.join("\n");
  if (preview.length > CHAT_USER_MESSAGE_PREVIEW_CHARS) {
    preview = preview.slice(0, CHAT_USER_MESSAGE_PREVIEW_CHARS).trimEnd();
  }
  return preview;
}
