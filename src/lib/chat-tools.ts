import { settingsStore } from "@/lib/settings-store";

export type ChatToolPackId = "analytics" | "commit" | "looker";

export type ChatToolsSettings = Record<ChatToolPackId, boolean>;

export const DEFAULT_CHAT_TOOLS: ChatToolsSettings = {
  analytics: false,
  commit: false,
  looker: false,
};

export type ChatToolPackMeta = {
  id: ChatToolPackId;
  label: string;
  description: string;
  examples: string[];
  keyLabel: string;
  keysPath: "/settings/keys";
};

export const CHAT_TOOL_PACKS: ChatToolPackMeta[] = [
  {
    id: "analytics",
    label: "Analytics",
    description: "查询站点流量（浏览量、访客、跳出率）。",
    examples: ["最近 7 天各站流量怎么样？", "列出我有哪些分析站点", "今天哪个站访客最多？"],
    keyLabel: "Tan Dataer API Key",
    keysPath: "/settings/keys",
  },
  {
    id: "commit",
    label: "Commit",
    description: "查看提交活跃度与最近提交记录。",
    examples: ["我这周都提交了什么？", "最近的提交活跃度怎么样？", "列出最近 10 条提交"],
    keyLabel: "Commit API Key",
    keysPath: "/settings/keys",
  },
  {
    id: "looker",
    label: "Looker",
    description: "浏览内容监控列表与最新条目。",
    examples: ["看看有哪些监控", "读取某个监控的最新内容", "监控列表里最近更新了什么？"],
    keyLabel: "Looker API Key",
    keysPath: "/settings/keys",
  },
];

const CHAT_TOOLS_STORE_KEY = "chatTools";
const CHAT_TOOLS_STORAGE_KEY = "m-dashboard-chat-tools-v1";

function isChatToolPackId(value: unknown): value is ChatToolPackId {
  return value === "analytics" || value === "commit" || value === "looker";
}

function normalizeChatTools(value: unknown): ChatToolsSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CHAT_TOOLS };
  }
  const record = value as Record<string, unknown>;
  return {
    analytics: record.analytics === true,
    commit: record.commit === true,
    looker: record.looker === true,
  };
}

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function loadChatToolsSettings(): Promise<ChatToolsSettings> {
  if (isTauri()) {
    try {
      const stored = await settingsStore.get<unknown>(CHAT_TOOLS_STORE_KEY);
      if (stored) {
        return normalizeChatTools(stored);
      }
    } catch (error) {
      console.error("Failed to load chat tools settings from Tauri Store", error);
    }
  }

  try {
    const raw = window.localStorage.getItem(CHAT_TOOLS_STORAGE_KEY);
    if (raw) {
      return normalizeChatTools(JSON.parse(raw));
    }
  } catch (error) {
    console.error("Failed to load chat tools settings from localStorage", error);
  }

  return { ...DEFAULT_CHAT_TOOLS };
}

export async function saveChatToolsSettings(settings: ChatToolsSettings) {
  const next = normalizeChatTools(settings);
  if (isTauri()) {
    try {
      await settingsStore.set(CHAT_TOOLS_STORE_KEY, next);
      await settingsStore.save();
      window.localStorage.removeItem(CHAT_TOOLS_STORAGE_KEY);
      return;
    } catch (error) {
      console.error("Failed to save chat tools settings to Tauri Store", error);
    }
  }

  window.localStorage.setItem(CHAT_TOOLS_STORAGE_KEY, JSON.stringify(next));
}

export function getEnabledPackIds(settings: ChatToolsSettings): ChatToolPackId[] {
  return CHAT_TOOL_PACKS.map((pack) => pack.id).filter((id) => settings[id]);
}

export function getPackMeta(id: ChatToolPackId): ChatToolPackMeta {
  const pack = CHAT_TOOL_PACKS.find((item) => item.id === id);
  if (!pack) {
    throw new Error(`Unknown chat tool pack: ${id}`);
  }
  return pack;
}

export function isChatToolPackEnabled(
  settings: ChatToolsSettings,
  id: string,
): id is ChatToolPackId {
  return isChatToolPackId(id) && settings[id] === true;
}
