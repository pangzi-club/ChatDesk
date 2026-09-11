import type { SandboxMode } from "@chatdesk/shared";
import { loadChatServerConfig, saveChatServerConfig } from "@/lib/server/chat-server";
import { createSettingsAdapter } from "@/lib/settings/create-settings-adapter";

export const CHAT_SANDBOX_MODES = ["ask", "auto", "full"] as const;

export type ChatSandboxMode = SandboxMode;

export const DEFAULT_CHAT_SANDBOX_MODE: ChatSandboxMode = "full";

export const CHAT_SANDBOX_MODE_LABELS: Record<ChatSandboxMode, string> = {
  ask: "Ask for approval",
  auto: "Approve for me",
  full: "Full access",
};

export const CHAT_SANDBOX_MODE_DESCRIPTIONS: Record<ChatSandboxMode, string> = {
  ask: "需要审批的写入和越界请求先询问你。",
  auto: "先在沙箱内执行；仅被沙箱拦截时交给 Reviewer。",
  full: "工具将直接执行，适合你信任的工作区。",
};

const CHAT_SANDBOX_STORAGE_KEY = "chatdesk-chat-sandbox-mode-v1";
const CHAT_SANDBOX_LEGACY_STORAGE_KEY = "m-dashboard-chat-sandbox-mode-v1";

export function normalizeChatSandboxMode(value: unknown): ChatSandboxMode {
  return value === "ask" || value === "auto" || value === "full" ? value : "full";
}

const CHAT_SANDBOX_ADAPTER = createSettingsAdapter<ChatSandboxMode>({
  storageKey: CHAT_SANDBOX_STORAGE_KEY,
  legacyStorageKeys: [CHAT_SANDBOX_LEGACY_STORAGE_KEY],
  normalize: normalizeChatSandboxMode,
  defaultValue: DEFAULT_CHAT_SANDBOX_MODE,
  label: "chat sandbox mode",
  // The Chat Server config is the source of truth; localStorage only backs it up.
  primaryStore: {
    read: async () => (await loadChatServerConfig()).sandboxMode || undefined,
    write: async (value) => {
      await saveChatServerConfig({ sandboxMode: value });
    },
  },
});

export function loadChatSandboxMode(): Promise<ChatSandboxMode> {
  return CHAT_SANDBOX_ADAPTER.load();
}

export function saveChatSandboxMode(mode: ChatSandboxMode): Promise<void> {
  return CHAT_SANDBOX_ADAPTER.save(mode);
}
