export function tabId() {
  return `chat-window-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
