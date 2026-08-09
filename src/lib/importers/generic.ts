import {
  type ArchiveMessage,
  type ArchiveSession,
  createArchiveSessionId,
  type ImportedArchiveSource,
  truncateTitle,
} from "@/lib/chat-archive";

type GenericImportOptions = {
  externalId: string;
  sourcePath: string;
  titleHint?: string | null;
  cwdHint?: string | null;
};

type CandidateMessage = {
  role: "user" | "assistant";
  text: string;
  createdAt?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function parseValue(value: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function extractText(value: unknown, depth = 0): string {
  if (depth > 8 || value == null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => extractText(item, depth + 1))
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  const record = asRecord(value);
  if (!record) return "";
  for (const key of ["text", "content", "message", "output_text", "output", "value"]) {
    const text = extractText(record[key], depth + 1);
    if (text) return text;
  }
  return "";
}

function timestampOf(record: Record<string, unknown>): string | undefined {
  for (const key of ["createdAt", "created_at", "timestamp", "time", "date"]) {
    const value = record[key];
    if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) return value;
    if (typeof value === "number") {
      const date = new Date(value < 10_000_000_000 ? value * 1000 : value);
      if (!Number.isNaN(date.getTime())) return date.toISOString();
    }
  }
  return undefined;
}

function collectMessages(value: unknown, target: CandidateMessage[], depth = 0): void {
  if (depth > 12 || value == null) return;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      collectMessages(parseValue(trimmed), target, depth + 1);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMessages(item, target, depth + 1);
    return;
  }
  const record = asRecord(value);
  if (!record) return;

  const roleValue = record.role ?? record.author ?? record.sender ?? record.speaker ?? record.type;
  const role =
    roleValue === "user" || roleValue === "human"
      ? "user"
      : roleValue === "assistant" || roleValue === "model"
        ? "assistant"
        : undefined;
  if (role) {
    const text = extractText(record.content ?? record.text ?? record.message ?? record.output);
    if (text) target.push({ role, text, createdAt: timestampOf(record) });
  }

  for (const child of Object.values(record)) collectMessages(child, target, depth + 1);
}

function parseGenericSession(
  contents: string,
  source: ImportedArchiveSource,
  options: GenericImportOptions,
): ArchiveSession {
  const candidates: CandidateMessage[] = [];
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed) collectMessages(parseValue(trimmed), candidates);
  }

  const messages: ArchiveMessage[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const key = `${candidate.role}:${candidate.createdAt ?? ""}:${candidate.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    messages.push({
      id: crypto.randomUUID(),
      role: candidate.role,
      text: candidate.text,
      createdAt: candidate.createdAt,
    });
  }

  const timestamps = messages
    .map((message) => message.createdAt)
    .filter((value): value is string => Boolean(value))
    .sort();
  const now = new Date().toISOString();
  const firstUser = messages.find((message) => message.role === "user" && message.text.trim());
  return {
    schemaVersion: 1,
    id: createArchiveSessionId(),
    source,
    externalId: options.externalId,
    title: options.titleHint?.trim() || truncateTitle(firstUser?.text ?? ""),
    cwd: options.cwdHint?.trim() || undefined,
    sourcePath: options.sourcePath,
    createdAt: timestamps[0] ?? now,
    updatedAt: timestamps[timestamps.length - 1] ?? now,
    importedAt: now,
    messages,
    assetCount: 0,
  };
}

export function parseCursorSession(contents: string, options: GenericImportOptions) {
  return parseGenericSession(contents, "cursor", options);
}

export function parseKimiSession(contents: string, options: GenericImportOptions) {
  return parseGenericSession(contents, "kimi", options);
}
