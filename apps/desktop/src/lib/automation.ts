import { loadServerAutomations, saveServerAutomations } from "@/lib/chat-server";

export const AUTOMATION_TASKS_STORE_KEY = "automation-tasks";

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
  const stored = await loadServerAutomations();
  return Array.isArray(stored) ? stored.filter(isAutomationTask) : [];
}

export async function saveAutomationTasks(tasks: AutomationTask[]) {
  await saveServerAutomations(tasks);
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
