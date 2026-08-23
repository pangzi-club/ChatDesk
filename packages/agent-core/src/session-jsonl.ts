import type { ChatSession } from "./protocol.ts";

export const SESSION_META_FILE = "meta.json";
export const SESSION_MESSAGES_FILE = "messages.jsonl";

export type SessionWriteCache = {
  lines: string[];
  lastLineStart: number;
  fileSize: number;
};

export function serializeSessionMeta(session: ChatSession): string {
  const { messages: _messages, ...meta } = session;
  return JSON.stringify(meta, null, 2);
}

export function serializeMessageLine(message: unknown): string {
  return JSON.stringify(message);
}

export function serializeMessagesJsonl(messages: readonly unknown[]): string {
  if (messages.length === 0) return "";
  return `${messages.map((message) => serializeMessageLine(message)).join("\n")}\n`;
}

export function splitJsonlLines(text: string): string[] {
  if (!text) return [];
  const trimmed = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (!trimmed) return [];
  return trimmed.split("\n").filter((line) => line.length > 0);
}

export function lineByteLength(line: string): number {
  return Buffer.byteLength(line, "utf8") + 1;
}

export function lastLineStart(lines: readonly string[]): number {
  let offset = 0;
  for (let index = 0; index < lines.length - 1; index += 1) {
    offset += lineByteLength(lines[index] ?? "");
  }
  return offset;
}

export function jsonlByteSize(lines: readonly string[]): number {
  let size = 0;
  for (const line of lines) size += lineByteLength(line);
  return size;
}

export function parseMessagesJsonl(text: string): { messages: unknown[]; ok: boolean } {
  const lines = splitJsonlLines(text);
  const messages: unknown[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    try {
      messages.push(JSON.parse(lines[index] ?? ""));
    } catch {
      if (index === lines.length - 1) break;
      return { messages: [], ok: false };
    }
  }
  return { messages, ok: true };
}

export function cacheFromRawLines(
  rawLines: readonly string[],
  messages: readonly unknown[],
): SessionWriteCache {
  return {
    lines: messages.map((message) => serializeMessageLine(message)),
    lastLineStart: lastLineStart(rawLines),
    fileSize: jsonlByteSize(rawLines),
  };
}

export function cacheFromSerializedLines(lines: readonly string[]): SessionWriteCache {
  return {
    lines: [...lines],
    lastLineStart: lastLineStart(lines),
    fileSize: jsonlByteSize(lines),
  };
}

export function prefixUnchanged(
  previous: readonly string[],
  next: readonly string[],
  length: number,
) {
  if (previous.length < length || next.length < length) return false;
  for (let index = 0; index < length; index += 1) {
    if (previous[index] !== next[index]) return false;
  }
  return true;
}
