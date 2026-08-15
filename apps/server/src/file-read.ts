import { readFile, stat } from "node:fs/promises";

export const MAX_READ_OUTPUT_BYTES = 64 * 1024;
export const MAX_READ_LINES = 400;

export type ReadFileOptions = {
  startLine?: number;
  endLine?: number;
};

export type ReadFileResult = {
  path: string;
  content: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
};

function truncateUtf8(value: string, maxBytes: number) {
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const nextBytes = Buffer.byteLength(character);
    if (bytes + nextBytes > maxBytes) break;
    bytes += nextBytes;
    end += character.length;
  }
  return { value: value.slice(0, end), truncated: end < value.length };
}

export async function readTextFileRange(
  target: string,
  displayPath: string,
  options: ReadFileOptions = {},
): Promise<ReadFileResult> {
  const metadata = await stat(target);
  if (!metadata.isFile()) throw new Error("路径不是文件");
  const source = await readFile(target, "utf8");
  if (!source) {
    return {
      path: displayPath,
      content: "",
      startLine: 0,
      endLine: 0,
      totalLines: 0,
      truncated: false,
    };
  }
  const lines = source.split(/\r?\n/);
  const startLine = options.startLine ?? 1;
  if (!Number.isInteger(startLine) || startLine < 1 || startLine > lines.length) {
    throw new Error(`startLine 必须在 1-${lines.length} 之间`);
  }
  const requestedEnd = options.endLine ?? Math.min(lines.length, startLine + MAX_READ_LINES - 1);
  if (!Number.isInteger(requestedEnd) || requestedEnd < startLine) {
    throw new Error("endLine 必须大于或等于 startLine");
  }
  if (requestedEnd - startLine + 1 > MAX_READ_LINES) {
    throw new Error(`单次最多读取 ${MAX_READ_LINES} 行`);
  }
  const requestedActualEnd = Math.min(requestedEnd, lines.length);
  const output: string[] = [];
  let outputBytes = 0;
  let endLine = startLine - 1;
  let byteTruncated = false;
  for (let lineNumber = startLine; lineNumber <= requestedActualEnd; lineNumber += 1) {
    const separator = output.length > 0 ? "\n" : "";
    const line = lines[lineNumber - 1] ?? "";
    const remainingBytes = MAX_READ_OUTPUT_BYTES - outputBytes;
    if (remainingBytes <= 0) {
      byteTruncated = true;
      break;
    }
    const bounded = truncateUtf8(`${separator}${line}`, remainingBytes);
    output.push(bounded.value);
    outputBytes += Buffer.byteLength(bounded.value);
    endLine = lineNumber;
    if (bounded.truncated) {
      byteTruncated = true;
      break;
    }
  }
  return {
    path: displayPath,
    content: output.join(""),
    startLine,
    endLine,
    totalLines: lines.length,
    truncated: byteTruncated || startLine > 1 || endLine < lines.length,
  };
}
