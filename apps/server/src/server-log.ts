const CHAT_SERVER_LOG_PREFIX = "[Chat Server]";

function formatServerLog(message: string): string {
  const text = message.trim();
  return text.length > 0 ? `${CHAT_SERVER_LOG_PREFIX} ${text}` : CHAT_SERVER_LOG_PREFIX;
}

export function logServerInfo(message: string): void {
  console.log(formatServerLog(message));
}

export function logServerWarn(message: string): void {
  console.warn(formatServerLog(message));
}

export function logServerError(message: string): void {
  console.error(formatServerLog(message));
}

/**
 * Renders loosely typed logger arguments — including the nested arrays the
 * Feishu SDK passes — as a single readable line.
 */
export function formatLogArguments(args: readonly unknown[]): string {
  return args.map(stringifyLogArgument).join(" ").replace(/\s+/g, " ").trim();
}

function stringifyLogArgument(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof Error) return value.message;
  if (Array.isArray(value)) return value.map(stringifyLogArgument).join(" ");
  if (value === null || value === undefined) return String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}
