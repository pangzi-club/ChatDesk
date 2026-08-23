import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatServerAiUsageLog, ChatTokenUsage } from "@chatdesk/shared";

const AI_USAGE_LOG_FILE = "ai-usage-log.json";
const AI_USAGE_JSONL_FILE = "ai-usage-log.jsonl";
const LEGACY_MIRROR_LIMIT = 1000;

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
    (entry.sessionId === undefined || typeof entry.sessionId === "string") &&
    (entry.runId === undefined || typeof entry.runId === "string") &&
    (entry.callId === undefined || typeof entry.callId === "string") &&
    (entry.invocationIndex === undefined ||
      (typeof entry.invocationIndex === "number" && Number.isInteger(entry.invocationIndex))) &&
    (entry.providerModelId === undefined || typeof entry.providerModelId === "string") &&
    (entry.responseId === undefined || typeof entry.responseId === "string") &&
    isUsage(entry.usage)
  );
}

function parseLegacy(value: string): ChatServerAiUsageLog[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(isEntry) : [];
  } catch {
    return [];
  }
}

function parseJsonLines(value: string): ChatServerAiUsageLog[] {
  const entries: ChatServerAiUsageLog[] = [];
  for (const line of value.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isEntry(parsed)) entries.push(parsed);
    } catch {
      // A crash can leave the final append incomplete; earlier lines remain valid.
    }
  }
  return entries;
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
  private readonly legacyFile: string;
  private readonly jsonlFile: string;
  private entries: ChatServerAiUsageLog[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.legacyFile = path.join(dataDir, AI_USAGE_LOG_FILE);
    this.jsonlFile = path.join(dataDir, AI_USAGE_JSONL_FILE);
  }

  async init() {
    await mkdir(path.dirname(this.jsonlFile), { recursive: true });
    const [jsonlEntries, legacyEntries] = await Promise.all([
      readFile(this.jsonlFile, "utf8")
        .then(parseJsonLines)
        .catch(() => []),
      readFile(this.legacyFile, "utf8")
        .then(parseLegacy)
        .catch(() => []),
    ]);
    const byId = new Map(jsonlEntries.map((entry) => [entry.id, entry]));
    const missingLegacy = legacyEntries.filter((entry) => !byId.has(entry.id));
    if (missingLegacy.length > 0) {
      await appendFile(
        this.jsonlFile,
        `${missingLegacy.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
        "utf8",
      );
      for (const entry of missingLegacy) byId.set(entry.id, entry);
    }
    this.entries = [...byId.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
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
    this.entries = [next, ...this.entries];
    const write = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.jsonlFile), { recursive: true });
      await appendFile(this.jsonlFile, `${JSON.stringify(next)}\n`, "utf8");
      const temporary = `${this.legacyFile}.${process.pid}.tmp`;
      await writeFile(
        temporary,
        JSON.stringify(this.entries.slice(0, LEGACY_MIRROR_LIMIT), null, 2),
        "utf8",
      );
      await rename(temporary, this.legacyFile);
    });
    this.writeQueue = write.catch(() => undefined);
    await write;
    return structuredClone(next);
  }
}
