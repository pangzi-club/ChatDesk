import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { settingsStore } from "@/lib/settings-store";

export type AssistantStatus = "unconfigured" | "starting" | "connected" | "stopped" | "error";

export type AssistantConnection = {
  status: AssistantStatus;
  detail?: string;
  updatedAt: string;
};

export type AssistantConversation = {
  id: string;
  openId: string;
  displayName: string;
  lastMessage: string;
  lastMessageAt: string;
  unreadCount: number;
};

export type AssistantMessage = {
  id: string;
  conversationId: string;
  openId: string;
  direction: "inbound" | "outbound";
  text: string;
  timestamp: string;
  status?: "sent" | "failed";
};

export type AssistantMessageEvent = {
  conversation: AssistantConversation;
  message: AssistantMessage;
};

export const FEISHU_APP_ID_KEY = "FEISHU_APP_ID";
export const FEISHU_APP_SECRET_KEY = "FEISHU_APP_SECRET";
export const ASSISTANT_ENABLED_KEY = "ASSISTANT_ENABLED";
export const ASSISTANT_NOTIFICATIONS_KEY = "ASSISTANT_NOTIFICATIONS";

export async function loadAssistantEnabled() {
  return (await settingsStore.get<boolean>(ASSISTANT_ENABLED_KEY)) ?? true;
}

export async function saveAssistantEnabled(enabled: boolean) {
  await settingsStore.set(ASSISTANT_ENABLED_KEY, enabled);
  await settingsStore.save();
}

export async function loadAssistantNotificationsEnabled() {
  return (await settingsStore.get<boolean>(ASSISTANT_NOTIFICATIONS_KEY)) ?? true;
}

export async function saveAssistantNotificationsEnabled(enabled: boolean) {
  await settingsStore.set(ASSISTANT_NOTIFICATIONS_KEY, enabled);
  await settingsStore.save();
}

export async function requestAssistantNotificationPermission() {
  if (!("Notification" in globalThis)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  return (await Notification.requestPermission()) === "granted";
}

export function showAssistantNotification(title: string, body: string) {
  if (!("Notification" in globalThis) || Notification.permission !== "granted") return;
  new Notification(title, { body });
}

export async function loadFeishuCredentials() {
  const [appId, appSecret] = await Promise.all([
    settingsStore.get<string>(FEISHU_APP_ID_KEY),
    settingsStore.get<string>(FEISHU_APP_SECRET_KEY),
  ]);
  return { appId: appId?.trim() ?? "", appSecret: appSecret?.trim() ?? "" };
}

export async function saveFeishuCredentials(appId: string, appSecret: string) {
  await settingsStore.set(FEISHU_APP_ID_KEY, appId.trim());
  await settingsStore.set(FEISHU_APP_SECRET_KEY, appSecret.trim());
  await settingsStore.save();
}

export async function clearFeishuCredentials() {
  await settingsStore.delete(FEISHU_APP_ID_KEY);
  await settingsStore.delete(FEISHU_APP_SECRET_KEY);
  await settingsStore.save();
}

export async function startAssistant(appId: string, appSecret: string) {
  return invoke<AssistantConnection>("assistant_start", { appId, appSecret });
}

export async function stopAssistant() {
  return invoke<AssistantConnection>("assistant_stop");
}

export async function restartAssistant(appId: string, appSecret: string) {
  return invoke<AssistantConnection>("assistant_restart", { appId, appSecret });
}

export async function loadAssistantStatus() {
  return invoke<AssistantConnection>("assistant_status");
}

export async function loadAssistantConversations() {
  return invoke<AssistantConversation[]>("assistant_list_conversations");
}

export async function loadAssistantMessages(conversationId: string) {
  return invoke<AssistantMessage[]>("assistant_get_messages", { conversationId });
}

export async function markAssistantConversationRead(conversationId: string) {
  return invoke<void>("assistant_mark_conversation_read", { conversationId });
}

export async function deleteAssistantConversation(conversationId: string) {
  return invoke<void>("assistant_delete_conversation", { conversationId });
}

export async function sendAssistantMessage(conversationId: string, text: string) {
  return invoke<AssistantMessage>("assistant_send_message", { conversationId, text });
}

export function listenAssistantStatus(
  handler: (status: AssistantConnection) => void,
): Promise<UnlistenFn> {
  return listen<AssistantConnection>("assistant-status", (event) => handler(event.payload));
}

export function listenAssistantMessage(
  handler: (event: AssistantMessageEvent) => void,
): Promise<UnlistenFn> {
  return listen<AssistantMessageEvent>("assistant-message", (event) => handler(event.payload));
}

export function listenAssistantError(handler: (message: string) => void): Promise<UnlistenFn> {
  return listen<{ message: string }>("assistant-error", (event) => handler(event.payload.message));
}
