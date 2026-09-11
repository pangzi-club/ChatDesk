export const CHAT_SERVER_OUTPUT_PREFIX = "[Chat Server]";

export type ChatServerOutputStream = "stdout" | "stderr";

export type ChatServerOutputStyle = {
  /** Prefix added to every non-empty line. Defaults to `[Chat Server]`. */
  prefix?: string;
  /** Leading whitespace added before the prefix, for dev console alignment. */
  indent?: string;
};

/**
 * Normalizes supervised Chat Server output for the terminal.
 *
 * The child already prefixes its own messages, so the raw stream would render
 * as `[Chat Server] [Chat Server] ...`. This formatter guarantees exactly one
 * prefix per line and prefixes every line of a multi-line chunk, while leaving
 * blank lines alone. Partial lines carry over between chunks so a chunk that
 * splits a line never produces a prefix in the middle of that line.
 */
export function createChatServerOutputFormatter(style: ChatServerOutputStyle = {}) {
  const prefix = style.prefix ?? CHAT_SERVER_OUTPUT_PREFIX;
  const indent = style.indent ?? "";
  const atLineStart: Record<ChatServerOutputStream, boolean> = { stdout: true, stderr: true };

  return (stream: ChatServerOutputStream, text: string): string => {
    if (text.length === 0) return "";
    const output: string[] = [];
    let lineStart = atLineStart[stream];
    let cursor = 0;

    while (cursor < text.length) {
      const newline = text.indexOf("\n", cursor);
      const end = newline === -1 ? text.length : newline;
      const body = text.slice(cursor, end).replace(/\r$/, "");
      if (lineStart && body.trim().length > 0) {
        output.push(body.startsWith(prefix) ? `${indent}${body}` : `${indent}${prefix} ${body}`);
      } else {
        output.push(body);
      }
      if (newline === -1) {
        lineStart = false;
        cursor = text.length;
      } else {
        output.push("\n");
        lineStart = true;
        cursor = newline + 1;
      }
    }

    atLineStart[stream] = lineStart;
    return output.join("");
  };
}
