import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type AutomationTask = {
  id: string;
  name: string;
  type: "log-current-time";
  intervalMinutes: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
};

function isTask(value: unknown): value is AutomationTask {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AutomationTask>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    item.type === "log-current-time" &&
    typeof item.intervalMinutes === "number" &&
    item.intervalMinutes > 0 &&
    typeof item.enabled === "boolean" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

export class AutomationStore {
  private readonly file: string;
  private value: AutomationTask[] = [];

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "automations.json");
  }

  async init() {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      this.value = Array.isArray(parsed) ? parsed.filter(isTask) : [];
    } catch {
      this.value = [];
    }
  }

  list() {
    return structuredClone(this.value);
  }

  async replace(value: unknown) {
    if (!Array.isArray(value) || !value.every(isTask)) throw new Error("Automation 配置无效");
    this.value = structuredClone(value);
    await this.save();
    return this.list();
  }

  async remove(id: string) {
    this.value = this.value.filter((item) => item.id !== id);
    await this.save();
    return this.list();
  }

  private async save() {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2), "utf8");
    await rename(temporary, this.file);
  }
}

export class AutomationScheduler {
  private timer?: NodeJS.Timeout;
  private readonly nextRuns = new Map<string, number>();
  private readonly store: AutomationStore;
  private readonly onLog: (task: AutomationTask, message: string) => Promise<void>;

  constructor(
    store: AutomationStore,
    onLog: (task: AutomationTask, message: string) => Promise<void>,
  ) {
    this.store = store;
    this.onLog = onLog;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), 1_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  async runNow(id: string) {
    const task = this.store.list().find((item) => item.id === id);
    if (!task) throw new Error("Automation 任务不存在");
    await this.execute(task);
  }

  private async tick() {
    const now = Date.now();
    const tasks = this.store.list();
    const ids = new Set(tasks.map((task) => task.id));
    for (const id of this.nextRuns.keys()) if (!ids.has(id)) this.nextRuns.delete(id);
    for (const task of tasks) {
      if (!task.enabled) {
        this.nextRuns.delete(task.id);
        continue;
      }
      const interval = task.intervalMinutes * 60_000;
      const next = this.nextRuns.get(task.id) ?? now + interval;
      if (now < next) {
        this.nextRuns.set(task.id, next);
        continue;
      }
      this.nextRuns.set(task.id, now + interval);
      await this.execute(task).catch((error) =>
        console.error(`[Chat Server] Automation ${task.id} failed`, error),
      );
    }
  }

  private execute(task: AutomationTask) {
    const message = `当前时间：${new Date().toLocaleString("zh-CN")}`;
    return this.onLog(task, message);
  }
}
