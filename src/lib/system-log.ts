import { invoke } from "@tauri-apps/api/core";
import { settingsStore } from "@/lib/settings-store";

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
    const contents = await invoke<string>("read_system_logs");
    const stored = parseLogs(contents);
    if (stored.length > 0) return stored;

    // Migrate logs created before they moved out of settings.json.
    const legacy = await settingsStore.get<unknown>(SYSTEM_LOGS_STORE_KEY);
    const migrated = Array.isArray(legacy) ? legacy.filter(isSystemLog) : [];
    if (migrated.length > 0) {
      await writeSystemLogs(migrated);
      await settingsStore.delete(SYSTEM_LOGS_STORE_KEY);
      await settingsStore.save();
    }
    return sortLogs(migrated);
  } catch {
    // Keep the web preview usable when Tauri commands are unavailable.
    const stored = await settingsStore.get<unknown>(SYSTEM_LOGS_STORE_KEY);
    return sortLogs(Array.isArray(stored) ? stored.filter(isSystemLog) : []);
  }
}

export async function appendSystemLog(entry: Omit<SystemLog, "id" | "timestamp">): Promise<void> {
  const logs = await loadSystemLogs();
  const next: SystemLog = {
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
  };
  await writeSystemLogs([next, ...logs].slice(0, 200));
}

export async function clearSystemLogs(): Promise<void> {
  await writeSystemLogs([]);
}

async function writeSystemLogs(logs: SystemLog[]): Promise<void> {
  try {
    await invoke("write_system_logs", { contents: JSON.stringify(logs) });
  } catch {
    // Keep the web preview usable when Tauri commands are unavailable.
    await settingsStore.set(SYSTEM_LOGS_STORE_KEY, logs);
    await settingsStore.save();
  }
}

function parseLogs(contents: string): SystemLog[] {
  try {
    const stored: unknown = JSON.parse(contents);
    return sortLogs(Array.isArray(stored) ? stored.filter(isSystemLog) : []);
  } catch {
    return [];
  }
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
