import { settingsStore } from "@/lib/settings-store";

export const AUTOMATION_TASKS_STORE_KEY = "automation-tasks";
const AUTOMATION_TASKS_LOCAL_STORAGE_KEY = "m-dashboard-automation-tasks-v1";

export type AutomationTaskType = "log-current-time";

export type AutomationTask = {
  id: string;
  name: string;
  type: AutomationTaskType;
  intervalMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

export const automationTaskTypeLabels: Record<AutomationTaskType, string> = {
  "log-current-time": "输出当前时间到日志",
};

export async function loadAutomationTasks(): Promise<AutomationTask[]> {
  try {
    const stored = await settingsStore.get<unknown>(AUTOMATION_TASKS_STORE_KEY);
    return Array.isArray(stored) ? stored.filter(isAutomationTask) : [];
  } catch {
    try {
      const stored = window.localStorage.getItem(AUTOMATION_TASKS_LOCAL_STORAGE_KEY);
      const parsed: unknown = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed.filter(isAutomationTask) : [];
    } catch {
      return [];
    }
  }
}

export async function saveAutomationTasks(tasks: AutomationTask[]) {
  try {
    await settingsStore.set(AUTOMATION_TASKS_STORE_KEY, tasks);
    await settingsStore.save();
  } catch {
    window.localStorage.setItem(AUTOMATION_TASKS_LOCAL_STORAGE_KEY, JSON.stringify(tasks));
  }
}

function isAutomationTask(value: unknown): value is AutomationTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<AutomationTask>;
  return (
    typeof task.id === "string" &&
    typeof task.name === "string" &&
    task.type === "log-current-time" &&
    typeof task.intervalMinutes === "number" &&
    task.intervalMinutes > 0 &&
    typeof task.enabled === "boolean" &&
    typeof task.createdAt === "string" &&
    typeof task.updatedAt === "string"
  );
}
