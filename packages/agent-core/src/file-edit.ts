const MAX_EDIT_DIAGNOSTIC_BYTES = 2 * 1024;

function normalizeWhitespace(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function truncateUtf8(value: string, maxBytes: number) {
  const buffer = Buffer.from(value);
  if (buffer.byteLength <= maxBytes) return value;
  const marker = "\n[已截断]";
  let truncated = `${buffer
    .subarray(0, Math.max(0, maxBytes - Buffer.byteLength(marker)))
    .toString("utf8")}${marker}`;
  while (Buffer.byteLength(truncated) > maxBytes) {
    truncated = `${truncated.slice(0, -marker.length - 1)}${marker}`;
  }
  return truncated;
}

function occurrenceLines(content: string, needle: string) {
  const lines: number[] = [];
  let from = 0;
  let lineNumber = 1;
  while (from <= content.length && lines.length < 12) {
    const index = content.indexOf(needle, from);
    if (index < 0) break;
    lineNumber += content.slice(from, index).split("\n").length - 1;
    lines.push(lineNumber);
    from = index + Math.max(needle.length, 1);
    lineNumber += needle.split("\n").length - 1;
  }
  return lines;
}

export function buildEditFailureMessage(content: string, oldText: string, count: number) {
  if (count > 1) {
    const lines = occurrenceLines(content, oldText).slice(0, 12);
    return truncateUtf8(
      `oldText 必须只匹配一次；当前匹配 ${count} 次，起始行：${lines.join(", ")}${count > lines.length ? "…" : ""}`,
      MAX_EDIT_DIAGNOSTIC_BYTES,
    );
  }

  const contentLines = content.split("\n");
  const oldLines = oldText.split("\n");
  const firstNeedle = normalizeWhitespace(oldLines.find((line) => line.trim()) ?? oldText);
  const candidates = contentLines
    .map((line, index) => {
      const normalized = normalizeWhitespace(line);
      if (!normalized || !firstNeedle) return null;
      const whitespaceOnly = normalized === firstNeedle && line !== oldLines[0];
      const contains = normalized.includes(firstNeedle) || firstNeedle.includes(normalized);
      const sharedPrefix = [...normalized].findIndex(
        (char, offset) => char !== firstNeedle[offset],
      );
      const prefixLength =
        sharedPrefix < 0 ? Math.min(normalized.length, firstNeedle.length) : sharedPrefix;
      const score = whitespaceOnly ? 10_000 : contains ? 5_000 : prefixLength;
      return score > 2
        ? {
            line: index + 1,
            score,
            whitespaceOnly,
            text: line.trim().slice(0, 240),
          }
        : null;
    })
    .filter((value): value is NonNullable<typeof value> => value !== null)
    .sort((a, b) => b.score - a.score || a.line - b.line)
    .slice(0, 5);

  const details = candidates.length
    ? candidates
        .map(
          (candidate) =>
            `- 第 ${candidate.line} 行${candidate.whitespaceOnly ? "（仅空白不同）" : ""}: ${candidate.text}`,
        )
        .join("\n")
    : "未找到足够接近的候选行。";
  return truncateUtf8(`未找到要替换的文本。附近候选：\n${details}`, MAX_EDIT_DIAGNOSTIC_BYTES);
}
