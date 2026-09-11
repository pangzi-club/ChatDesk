/**
 * Chat Server connection defaults shared by every runtime: the desktop renderer,
 * the Node service, the Electron host, and the Chat Server process supervisor.
 *
 * Keep this as the single source of truth. The port is user-configurable, so any
 * code that falls back to a default must fall back to this value.
 */
export const CHAT_SERVER_DEFAULT_PORT = 14317;

export function normalizeChatServerPort(value: unknown) {
  const port = typeof value === "number" ? value : Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : CHAT_SERVER_DEFAULT_PORT;
}
