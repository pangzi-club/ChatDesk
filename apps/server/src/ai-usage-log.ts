import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatServerAiUsageLog, ChatTokenUsage } from "@chatdesk/shared";

const AI_USAGE_LOG_FILE = "ai-usage-log.json";

function isUsage(value: unknown): value is ChatTokenUsage {
  if (!value || typeof value !== "object") return false;
  return Object.values(value).every(
    (item) => item === undefined || (typeof item === "number" && Number.isFinite(item)),
  );
}

function isEntry(value: unknown): value is ChatServerAiUsageLog {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ChatServerAiUsageLog>;
  return (
    typeof entry.id === "string" &&
    typeof entry.timestamp === "string" &&
    typeof entry.operation === "string" &&
    isUsage(entry.usage)
  );
}

export function normalizeAiUsage(value: unknown): ChatTokenUsage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const source = value as Record<string, unknown>;
  const nestedNumber = (parent: string, key: string) => {
    const nested = source[parent];
    if (!nested || typeof nested !== "object") return undefined;
    const item = (nested as Record<string, unknown>)[key];
    return typeof item === "number" && Number.isFinite(item) ? item : undefined;
  };
  const number = (...keys: string[]) => {
    for (const key of keys) {
      const item = source[key];
      if (typeof item === "number" && Number.isFinite(item)) return item;
    }
    return undefined;
  };
  const usage: ChatTokenUsage = {
    inputTokens: number("inputTokens", "input_tokens", "prompt_tokens"),
    outputTokens: number("outputTokens", "output_tokens", "completion_tokens"),
    totalTokens: number("totalTokens", "total_tokens"),
    cacheReadTokens:
      nestedNumber("inputTokenDetails", "cacheReadTokens") ??
      number("cachedInputTokens", "cacheReadInputTokens", "cache_read_input_tokens"),
    cacheWriteTokens:
      nestedNumber("inputTokenDetails", "cacheWriteTokens") ??
      number("cacheWriteInputTokens", "cache_write_input_tokens"),
    reasoningOutputTokens:
      nestedNumber("outputTokenDetails", "reasoningTokens") ??
      number("reasoningTokens", "reasoning_output_tokens"),
  };
  return Object.values(usage).some((item) => item !== undefined) ? usage : undefined;
}

export class AiUsageLogStore {
  private readonly file: string;
  private entries: ChatServerAiUsageLog[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, AI_USAGE_LOG_FILE);
  }

  async init() {
    this.entries = await readFile(this.file, "utf8")
      .then((value) => {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
          ? parsed.filter(isEntry).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          : [];
      })
      .catch(() => []);
  }

  list() {
    return structuredClone(this.entries);
  }

  async append(input: Omit<ChatServerAiUsageLog, "id" | "timestamp">) {
    const next: ChatServerAiUsageLog = {
      ...input,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.entries = [next, ...this.entries].slice(0, 1000);
    const write = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(this.entries, null, 2), "utf8");
      await rename(temporary, this.file);
    });
    this.writeQueue = write.catch(() => undefined);
    await write;
    return structuredClone(next);
  }
}
