import {
  appendServerActivityLog,
  clearServerActivityLogs,
  loadServerActivityLogs,
} from "@/lib/chat-server";

export const SYSTEM_LOGS_STORE_KEY = "system-logs";
export type SystemLogLevel = "info" | "success" | "warning" | "error";

export type SystemLog = {
  id: string;
  timestamp: string;
  level: SystemLogLevel;
  source: string;
  message: string;
  details?: string;
};

export async function loadSystemLogs(): Promise<SystemLog[]> {
  try {
    const stored = await loadServerActivityLogs();
    return sortLogs(Array.isArray(stored) ? stored.filter(isSystemLog) : []);
  } catch {
    return [];
  }
}

export async function appendSystemLog(entry: Omit<SystemLog, "id" | "timestamp">): Promise<void> {
  await appendServerActivityLog(entry);
}

export async function clearSystemLogs(): Promise<void> {
  await clearServerActivityLogs();
}

function sortLogs(logs: SystemLog[]): SystemLog[] {
  return logs.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function isSystemLog(value: unknown): value is SystemLog {
  if (!value || typeof value !== "object") return false;
  const log = value as Partial<SystemLog>;
  return (
    typeof log.id === "string" &&
    typeof log.timestamp === "string" &&
    typeof log.source === "string" &&
    typeof log.message === "string" &&
    ["info", "success", "warning", "error"].includes(log.level ?? "")
  );
}
