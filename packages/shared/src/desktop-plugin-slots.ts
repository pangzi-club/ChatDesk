/**
 * Public desktop UI contribution slots shared by the renderer host, the plugin
 * SDK validation layer, and the agent harness `create_plugin` tool. Keep this
 * list in sync with the host runtime: a slot missing here is rejected by every
 * external plugin validator; a slot removed here stays accepted until the host
 * stops rendering it.
 */
export const DESKTOP_UI_SLOTS = [
  "sidebar.navigation",
  "settings.page",
  "route",
  "workspace.tab",
  "action",
  "shell.overlay",
  "shell.before",
  "shell.after",
  "sidebar.before",
  "sidebar.after",
  "sidebar.footer",
  "chat.header.action",
  "chat.composer.tool",
  "chat.messages.before",
  "chat.messages.after",
  "chat.composer.float",
  "chat.message.action",
  "chat.layout",
] as const;

export type DesktopUiSlotName = (typeof DESKTOP_UI_SLOTS)[number];
