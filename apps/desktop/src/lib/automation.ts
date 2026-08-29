import {
  loadServerAutomationRuns,
  loadServerAutomations,
  saveServerAutomations,
} from "@/lib/chat-server";

export const AUTOMATION_TASKS_STORE_KEY = "automation-tasks";

export type AutomationTask = {
  id: string;
  name: string;
  description: string;
  scheduleMode: "once" | "interval";
  intervalMinutes: number;
  startAt: string;
  agentId: string;
  notificationChannelId?: string;
  notificationContactId?: string;
  enabled: boolean;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRun = {
  id: string;
  taskId: string;
  source: "manual" | "scheduled";
  scheduledFor?: string;
  startedAt: string;
  finishedAt?: string;
  status: "queued" | "running" | "success" | "failed" | "skipped";
  output?: string;
  error?: string;
};

export async function loadAutomationTasks(): Promise<AutomationTask[]> {
  const stored = await loadServerAutomations();
  return Array.isArray(stored) ? stored.filter(isAutomationTask) : [];
}
export async function saveAutomationTasks(tasks: AutomationTask[]) {
  await saveServerAutomations(tasks);
}
export async function loadAutomationRuns(taskId: string): Promise<AutomationRun[]> {
  const stored = await loadServerAutomationRuns(taskId);
  return Array.isArray(stored) ? stored.filter(isAutomationRun) : [];
}

function isAutomationTask(value: unknown): value is AutomationTask {
  if (!value || typeof value !== "object") return false;
  const task = value as Partial<AutomationTask>;
  return (
    typeof task.id === "string" &&
    typeof task.name === "string" &&
    typeof task.description === "string" &&
    task.description.trim().length > 0 &&
    (task.scheduleMode === "once" || task.scheduleMode === "interval") &&
    typeof task.intervalMinutes === "number" &&
    task.intervalMinutes > 0 &&
    typeof task.startAt === "string" &&
    typeof task.agentId === "string" &&
    typeof task.enabled === "boolean" &&
    typeof task.createdAt === "string" &&
    typeof task.updatedAt === "string"
  );
}
function isAutomationRun(value: unknown): value is AutomationRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<AutomationRun>;
  return (
    typeof run.id === "string" &&
    typeof run.taskId === "string" &&
    (run.source === "manual" || run.source === "scheduled") &&
    typeof run.startedAt === "string" &&
    ["queued", "running", "success", "failed", "skipped"].includes(run.status ?? "")
  );
}
