export const CHANNEL_SESSION_IDLE_MS = 60 * 60 * 1000;

export type ChannelCommand = "help" | "status";

export function parseChannelCommand(text: string) {
  const command = text.trim().toLowerCase();
  if (command === "/help") return "help" as const;
  if (command === "/status" || command === "/stauts") return "status" as const;
  return undefined;
}

export function parseClearCommand(text: string) {
  const match = text.trim().match(/^\/clear(?:\s+([\s\S]*))?$/i);
  if (!match) return undefined;
  return { remainder: match[1]?.trim() ?? "" };
}

export function isChannelSessionIdle(lastMessageAt: string | undefined, now = Date.now()) {
  if (!lastMessageAt) return false;
  const timestamp = Date.parse(lastMessageAt);
  return Number.isFinite(timestamp) && now - timestamp >= CHANNEL_SESSION_IDLE_MS;
}
