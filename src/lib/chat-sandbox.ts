import { loadChatServerConfig, saveChatServerConfig } from "@/lib/chat-server";

export const CHAT_SANDBOX_MODES = ["ask", "auto", "full"] as const;

export type ChatSandboxMode = (typeof CHAT_SANDBOX_MODES)[number];

export const DEFAULT_CHAT_SANDBOX_MODE: ChatSandboxMode = "ask";

export const CHAT_SANDBOX_MODE_LABELS: Record<ChatSandboxMode, string> = {
  ask: "Ask for approval",
  auto: "Approve for me",
  full: "Full access",
};

const CHAT_SANDBOX_STORAGE_KEY = "m-dashboard-chat-sandbox-mode-v1";

export function normalizeChatSandboxMode(value: unknown): ChatSandboxMode {
  return value === "auto" || value === "full" ? value : "ask";
}

export async function loadChatSandboxMode(): Promise<ChatSandboxMode> {
  try {
    const config = await loadChatServerConfig();
    if (config.sandboxMode) return normalizeChatSandboxMode(config.sandboxMode);
  } catch (error) {
    console.error("Failed to load global chat sandbox mode", error);
  }

  try {
    return normalizeChatSandboxMode(window.localStorage.getItem(CHAT_SANDBOX_STORAGE_KEY));
  } catch (error) {
    console.error("Failed to load chat sandbox mode from localStorage", error);
    return DEFAULT_CHAT_SANDBOX_MODE;
  }
}

export async function saveChatSandboxMode(mode: ChatSandboxMode): Promise<void> {
  const next = normalizeChatSandboxMode(mode);
  try {
    await saveChatServerConfig({ sandboxMode: next });
    window.localStorage.removeItem(CHAT_SANDBOX_STORAGE_KEY);
    return;
  } catch (error) {
    console.error("Failed to save global chat sandbox mode", error);
  }

  try {
    window.localStorage.setItem(CHAT_SANDBOX_STORAGE_KEY, next);
  } catch (error) {
    console.error("Failed to save chat sandbox mode to localStorage", error);
  }
}
