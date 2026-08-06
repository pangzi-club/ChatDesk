import {
  type ArchiveAsset,
  type ArchiveMessage,
  type ArchiveSession,
  createArchiveSessionId,
  truncateTitle,
} from "@/lib/chat-archive";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function guessImageMediaType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return undefined;
}

function extractTextAndAssets(content: unknown): { text: string; assets: ArchiveAsset[] } {
  if (typeof content === "string") {
    return { text: content.trim(), assets: [] };
  }
  if (!Array.isArray(content)) {
    return { text: "", assets: [] };
  }

  const texts: string[] = [];
  const assets: ArchiveAsset[] = [];

  for (const part of content) {
    const record = asRecord(part);
    if (!record) continue;
    const type = typeof record.type === "string" ? record.type : "";

    if (type === "text" && typeof record.text === "string") {
      texts.push(record.text);
      continue;
    }

    if (type === "tool_result" || type === "tool_use") {
      continue;
    }

    if (type === "image" || type === "document" || type === "file") {
      const source = asRecord(record.source);
      const kind: ArchiveAsset["kind"] = type === "image" ? "image" : "file";
      if (source?.type === "base64") {
        // Skip embedded binaries; keep a placeholder chip only.
        assets.push({
          id: crypto.randomUUID(),
          kind,
          fileName:
            typeof record.name === "string" ? record.name : kind === "image" ? "image" : "file",
          mediaType: typeof source.media_type === "string" ? source.media_type : undefined,
        });
        continue;
      }
      if (typeof source?.url === "string") {
        assets.push({
          id: crypto.randomUUID(),
          kind,
          fileName: fileNameFromPath(source.url),
          url: source.url,
        });
        continue;
      }
      if (typeof source?.path === "string") {
        assets.push({
          id: crypto.randomUUID(),
          kind,
          fileName: fileNameFromPath(source.path),
          path: source.path,
          mediaType: kind === "image" ? guessImageMediaType(source.path) : undefined,
        });
      }
    }
  }

  return {
    text: texts.join("\n").trim(),
    assets,
  };
}

export function parseClaudeCodeSession(
  contents: string,
  options: {
    externalId: string;
    sourcePath: string;
    titleHint?: string | null;
    cwdHint?: string | null;
  },
): ArchiveSession {
  const messages: ArchiveMessage[] = [];
  let cwd = options.cwdHint?.trim() || undefined;
  let model: string | undefined;
  let createdAt: string | undefined;
  let updatedAt: string | undefined;

  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let row: Record<string, unknown>;
    try {
      row = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = typeof row.type === "string" ? row.type : "";
    if (type === "system" || type === "summary" || type === "file-history-snapshot") {
      continue;
    }
    if (type !== "user" && type !== "assistant") continue;
    if (row.isSidechain === true) continue;

    const timestamp = typeof row.timestamp === "string" ? row.timestamp : undefined;
    if (timestamp) {
      createdAt ??= timestamp;
      updatedAt = timestamp;
    }
    if (!cwd && typeof row.cwd === "string") cwd = row.cwd;

    const message = asRecord(row.message);
    if (!message) continue;
    if (!model && typeof message.model === "string") model = message.model;

    const { text, assets } = extractTextAndAssets(message.content);
    // Skip pure tool-result user turns.
    if (!text && assets.length === 0) continue;
    if (
      !text &&
      Array.isArray(message.content) &&
      message.content.every((part) => asRecord(part)?.type === "tool_result")
    ) {
      continue;
    }

    messages.push({
      id: typeof row.uuid === "string" ? row.uuid : crypto.randomUUID(),
      role: type === "user" ? "user" : "assistant",
      text,
      createdAt: timestamp,
      assets: assets.length > 0 ? assets : undefined,
    });
  }

  const firstUser = messages.find((message) => message.role === "user" && message.text.trim());
  const title = options.titleHint?.trim() || truncateTitle(firstUser?.text ?? "");
  const now = new Date().toISOString();
  const assetCount = messages.reduce((sum, message) => sum + (message.assets?.length ?? 0), 0);

  return {
    schemaVersion: 1,
    id: createArchiveSessionId(),
    source: "claude-code",
    externalId: options.externalId,
    title,
    cwd,
    model,
    sourcePath: options.sourcePath,
    createdAt: createdAt ?? now,
    updatedAt: updatedAt ?? createdAt ?? now,
    importedAt: now,
    messages,
    assetCount,
  };
}
