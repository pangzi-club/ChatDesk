import {
  type ArchiveAsset,
  type ArchiveMessage,
  type ArchiveSession,
  type ArchiveTokenUsage,
  createArchiveSessionId,
  truncateTitle,
} from "@/lib/chat-archive";
import { hasTokenUsage, normalizeTokenUsage, sumTokenUsages } from "@/lib/chat-usage";

function fileNameFromPath(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function isRemoteUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function collectAssets(images: unknown, localImages: unknown): ArchiveAsset[] {
  const assets: ArchiveAsset[] = [];
  const pushPath = (value: unknown, kind: ArchiveAsset["kind"]) => {
    if (typeof value !== "string" || !value.trim()) return;
    const trimmed = value.trim();
    if (isRemoteUrl(trimmed)) {
      assets.push({
        id: crypto.randomUUID(),
        kind,
        fileName: fileNameFromPath(trimmed),
        url: trimmed,
      });
      return;
    }
    assets.push({
      id: crypto.randomUUID(),
      kind,
      fileName: fileNameFromPath(trimmed),
      path: trimmed,
      mediaType: kind === "image" ? guessImageMediaType(trimmed) : undefined,
    });
  };

  if (Array.isArray(localImages)) {
    for (const item of localImages) pushPath(item, "image");
  }
  if (Array.isArray(images)) {
    for (const item of images) pushPath(item, "image");
  }
  return assets;
}

function guessImageMediaType(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".webp")) return "image/webp";
  return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function usageSignature(usage: ArchiveTokenUsage) {
  return [
    usage.inputTokens ?? "",
    usage.outputTokens ?? "",
    usage.totalTokens ?? "",
    usage.cacheReadTokens ?? "",
    usage.cacheWriteTokens ?? "",
    usage.reasoningOutputTokens ?? "",
  ].join("|");
}

function diffTokenUsage(
  current: ArchiveTokenUsage,
  previous?: ArchiveTokenUsage,
): ArchiveTokenUsage | undefined {
  if (!previous) return current;
  const keys = [
    "inputTokens",
    "outputTokens",
    "totalTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
    "reasoningOutputTokens",
  ] as const;
  const delta: ArchiveTokenUsage = {};
  for (const key of keys) {
    const curr = current[key];
    const prev = previous[key] ?? 0;
    if (typeof curr === "number") {
      const value = curr - prev;
      if (value > 0) delta[key] = value;
    }
  }
  return hasTokenUsage(delta) ? delta : undefined;
}

function extractTurnUsage(
  info: Record<string, unknown> | null,
  previousTotal?: ArchiveTokenUsage,
): { turn?: ArchiveTokenUsage; total?: ArchiveTokenUsage } {
  if (!info) return {};
  const last = normalizeTokenUsage(
    (asRecord(info.last_token_usage) ?? {}) as Parameters<typeof normalizeTokenUsage>[0],
  );
  const total = normalizeTokenUsage(
    (asRecord(info.total_token_usage) ?? {}) as Parameters<typeof normalizeTokenUsage>[0],
  );
  if (last && hasTokenUsage(last)) return { turn: last, total: total ?? last };
  if (total && hasTokenUsage(total)) {
    return { turn: diffTokenUsage(total, previousTotal), total };
  }
  return {};
}

export function parseCodexRollout(
  contents: string,
  options: {
    externalId: string;
    sourcePath: string;
    titleHint?: string | null;
  },
): ArchiveSession {
  const messages: ArchiveMessage[] = [];
  const turnUsages: ArchiveTokenUsage[] = [];
  let lastAssistantIndex = -1;
  let lastTotalSignature = "";
  let previousTotal: ArchiveTokenUsage | undefined;
  let cwd: string | undefined;
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

    const timestamp = typeof row.timestamp === "string" ? row.timestamp : undefined;
    if (timestamp) {
      createdAt ??= timestamp;
      updatedAt = timestamp;
    }

    if (row.type === "session_meta") {
      const payload = asRecord(row.payload);
      if (payload) {
        if (typeof payload.cwd === "string") cwd = payload.cwd;
        if (typeof payload.model === "string") model = payload.model;
      }
      continue;
    }

    if (row.type !== "event_msg") continue;
    const payload = asRecord(row.payload);
    if (!payload) continue;
    const payloadType = payload.type;

    if (payloadType === "token_count") {
      const info = asRecord(payload.info);
      const { turn: turnUsage, total: totalUsage } = extractTurnUsage(info, previousTotal);
      if (!turnUsage) continue;

      const signature = totalUsage ? usageSignature(totalUsage) : usageSignature(turnUsage);
      if (signature && signature === lastTotalSignature) continue;
      if (signature) lastTotalSignature = signature;
      if (totalUsage) previousTotal = totalUsage;

      turnUsages.push(turnUsage);
      if (lastAssistantIndex >= 0) {
        messages[lastAssistantIndex] = {
          ...messages[lastAssistantIndex],
          usage: turnUsage,
        };
      }
      continue;
    }

    if (payloadType !== "user_message" && payloadType !== "agent_message") continue;

    const text = typeof payload.message === "string" ? payload.message.trim() : "";
    const assets =
      payloadType === "user_message"
        ? collectAssets(payload.images, payload.local_images)
        : undefined;
    if (!text && (!assets || assets.length === 0)) continue;

    messages.push({
      id: crypto.randomUUID(),
      role: payloadType === "user_message" ? "user" : "assistant",
      text,
      createdAt: timestamp,
      assets: assets && assets.length > 0 ? assets : undefined,
    });
    if (payloadType === "agent_message") {
      lastAssistantIndex = messages.length - 1;
    }
  }

  const usageTotal = sumTokenUsages(turnUsages);
  const firstUser = messages.find((message) => message.role === "user" && message.text.trim());
  const title = options.titleHint?.trim() || truncateTitle(firstUser?.text ?? "");
  const now = new Date().toISOString();
  const assetCount = messages.reduce((sum, message) => sum + (message.assets?.length ?? 0), 0);

  return {
    schemaVersion: 1,
    id: createArchiveSessionId(),
    source: "codex",
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
    usageTotal: Object.keys(usageTotal).length > 0 ? usageTotal : undefined,
  };
}
