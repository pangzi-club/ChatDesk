import { invoke } from "@tauri-apps/api/core";

export const CHAT_MEMORY_SCHEMA_VERSION = 1;

export const MEMORY_ITEM_SOFT_LIMIT = 50;
export const MEMORY_INJECT_CHAR_SOFT_LIMIT = 2000;
export const MEMORY_COMPACT_TARGET_ITEMS = 30;
export const MEMORY_COMPACT_TARGET_CHARS = 1200;

export type ChatMemoryItem = {
  id: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  sourceSessionId?: string;
};

export type ChatMemoryStore = {
  schemaVersion: typeof CHAT_MEMORY_SCHEMA_VERSION;
  enabled: boolean;
  items: ChatMemoryItem[];
};

export const DEFAULT_CHAT_MEMORY: ChatMemoryStore = {
  schemaVersion: CHAT_MEMORY_SCHEMA_VERSION,
  enabled: true,
  items: [],
};

const MEMORY_STORAGE_KEY = "m-dashboard-chat-memory-v1";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function isChatMemoryItem(value: unknown): value is ChatMemoryItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChatMemoryItem>;
  return (
    typeof item.id === "string" &&
    typeof item.content === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

export function normalizeChatMemory(value: unknown): ChatMemoryStore {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CHAT_MEMORY };
  }

  const record = value as Partial<ChatMemoryStore>;
  const items = Array.isArray(record.items)
    ? record.items.filter(isChatMemoryItem).map((item) => ({
        id: item.id,
        content: item.content.trim(),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ...(typeof item.sourceSessionId === "string"
          ? { sourceSessionId: item.sourceSessionId }
          : {}),
      }))
    : [];

  return {
    schemaVersion: CHAT_MEMORY_SCHEMA_VERSION,
    enabled: typeof record.enabled === "boolean" ? record.enabled : DEFAULT_CHAT_MEMORY.enabled,
    items: items.filter((item) => item.content.length > 0),
  };
}

export function createMemoryId() {
  return crypto.randomUUID() as string;
}

export function createMemoryItem(
  content: string,
  options?: { sourceSessionId?: string; now?: string },
): ChatMemoryItem {
  const now = options?.now ?? new Date().toISOString();
  return {
    id: createMemoryId(),
    content: content.trim(),
    createdAt: now,
    updatedAt: now,
    ...(options?.sourceSessionId ? { sourceSessionId: options.sourceSessionId } : {}),
  };
}

export function formatMemoryForInject(items: ChatMemoryItem[]): string {
  if (items.length === 0) return "";
  const lines = items.map((item) => `- ${item.content.trim()}`).filter((line) => line.length > 2);
  if (lines.length === 0) return "";
  return ["以下是关于用户的长期记忆，请在相关时自然使用，不要主动复述整份列表。", ...lines].join(
    "\n",
  );
}

export function shouldCompactMemory(items: ChatMemoryItem[]): boolean {
  if (items.length >= MEMORY_ITEM_SOFT_LIMIT) return true;
  return formatMemoryForInject(items).length >= MEMORY_INJECT_CHAR_SOFT_LIMIT;
}

function normalizeFact(content: string) {
  return content
    .replace(/[\s，。！？、；：,.!?;:]+/g, "")
    .trim()
    .toLowerCase();
}

function findDuplicateIndex(items: ChatMemoryItem[], key: string) {
  return items.findIndex((item) => {
    const existingKey = normalizeFact(item.content);
    if (existingKey === key) return true;
    if (key.length < 8 || existingKey.length < 8) return false;
    return existingKey.includes(key) || key.includes(existingKey);
  });
}

export function mergeMemoryItems(
  existing: ChatMemoryItem[],
  incoming: Array<string | ChatMemoryItem>,
  options?: { sourceSessionId?: string },
): ChatMemoryItem[] {
  const now = new Date().toISOString();
  const merged = [...existing];

  for (const entry of incoming) {
    const content = (typeof entry === "string" ? entry : entry.content).trim();
    if (!content) continue;
    const key = normalizeFact(content);
    if (!key) continue;
    const duplicateIndex = findDuplicateIndex(merged, key);
    if (typeof entry === "string") {
      if (duplicateIndex >= 0) {
        const previous = merged[duplicateIndex];
        merged[duplicateIndex] = {
          ...previous,
          content,
          updatedAt: now,
          ...(options?.sourceSessionId ? { sourceSessionId: options.sourceSessionId } : {}),
        };
      } else {
        merged.push(createMemoryItem(content, { sourceSessionId: options?.sourceSessionId, now }));
      }
    } else {
      const nextItem = {
        ...entry,
        content,
        updatedAt: now,
        ...(options?.sourceSessionId && !entry.sourceSessionId
          ? { sourceSessionId: options.sourceSessionId }
          : {}),
      };
      if (duplicateIndex >= 0) merged[duplicateIndex] = nextItem;
      else merged.push(nextItem);
    }
  }

  return merged;
}

export function replaceMemoryItemsFromFacts(
  facts: string[],
  options?: { sourceSessionId?: string },
): ChatMemoryItem[] {
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const items: ChatMemoryItem[] = [];
  for (const fact of facts) {
    const content = fact.trim();
    const key = normalizeFact(content);
    if (!content || !key || seen.has(key)) continue;
    seen.add(key);
    items.push(createMemoryItem(content, { sourceSessionId: options?.sourceSessionId, now }));
  }
  return items;
}

export async function loadChatMemory(): Promise<ChatMemoryStore> {
  try {
    const contents = isTauri()
      ? await invoke<string>("read_chat_memory")
      : window.localStorage.getItem(MEMORY_STORAGE_KEY);
    return normalizeChatMemory(parseJson(contents, DEFAULT_CHAT_MEMORY));
  } catch (error) {
    console.error("Failed to load chat memory", error);
    const fallback = parseJson(
      window.localStorage.getItem(MEMORY_STORAGE_KEY),
      DEFAULT_CHAT_MEMORY,
    );
    return normalizeChatMemory(fallback);
  }
}

export async function saveChatMemory(store: ChatMemoryStore): Promise<ChatMemoryStore> {
  const next = normalizeChatMemory(store);
  const contents = JSON.stringify(next);
  if (isTauri()) {
    await invoke("write_chat_memory", { contents });
    window.localStorage.removeItem(MEMORY_STORAGE_KEY);
  } else {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, contents);
  }
  return next;
}
