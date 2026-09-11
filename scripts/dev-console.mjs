// Match Vite's console style: every dev log line is indented by two spaces.
export const DEV_CONSOLE_INDENT = "  ";

/**
 * Re-emits a child stream line by line with the shared dev console indentation.
 * Partial lines are buffered until the newline arrives (or `flush()` is called).
 *
 * @param {(text: string) => void} write destination for formatted lines
 * @param {string} [indent]
 */
export function createIndentedWriter(write, indent = DEV_CONSOLE_INDENT) {
  let pending = "";
  const writeLine = (line) => {
    const text = line.replace(/\r$/, "");
    write(text.length > 0 ? `${indent}${text}\n` : "\n");
  };
  const writer = (chunk) => {
    pending += String(chunk);
    const lines = pending.split("\n");
    pending = lines.pop() ?? "";
    for (const line of lines) writeLine(line);
  };
  writer.flush = () => {
    if (pending.length === 0) return;
    writeLine(pending);
    pending = "";
  };
  return writer;
}
