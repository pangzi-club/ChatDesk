import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { Cron } from "croner";

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

function isTask(value: unknown): value is AutomationTask {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AutomationTask>;
  return (
    typeof item.id === "string" &&
    typeof item.name === "string" &&
    typeof item.description === "string" &&
    item.description.trim().length > 0 &&
    (item.scheduleMode === "once" || item.scheduleMode === "interval") &&
    typeof item.intervalMinutes === "number" &&
    item.intervalMinutes > 0 &&
    typeof item.startAt === "string" &&
    !Number.isNaN(Date.parse(item.startAt)) &&
    typeof item.agentId === "string" &&
    item.agentId.trim().length > 0 &&
    (item.notificationChannelId === undefined || typeof item.notificationChannelId === "string") &&
    (item.notificationContactId === undefined || typeof item.notificationContactId === "string") &&
    typeof item.enabled === "boolean" &&
    (item.completedAt === undefined ||
      (typeof item.completedAt === "string" && !Number.isNaN(Date.parse(item.completedAt)))) &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

function isRun(value: unknown): value is AutomationRun {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<AutomationRun>;
  return (
    typeof item.id === "string" &&
    typeof item.taskId === "string" &&
    ["manual", "scheduled"].includes(item.source ?? "") &&
    typeof item.startedAt === "string" &&
    ["queued", "running", "success", "failed", "skipped"].includes(item.status ?? "")
  );
}

export class AutomationStore {
  private readonly file: string;
  private readonly runsFile: string;
  private value: AutomationTask[] = [];
  private runs: AutomationRun[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "automations.json");
    this.runsFile = path.join(dataDir, "automation-runs.json");
  }

  async init() {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      this.value = Array.isArray(parsed) ? parsed.filter(isTask) : [];
    } catch {
      this.value = [];
    }
    try {
      const parsed = JSON.parse(await readFile(this.runsFile, "utf8")) as unknown;
      this.runs = Array.isArray(parsed) ? parsed.filter(isRun) : [];
    } catch {
      this.runs = [];
    }
  }

  list() {
    return structuredClone(this.value.map((task) => this.withDerivedCompletion(task)));
  }
  get(id: string) {
    const task = this.value.find((item) => item.id === id);
    return task ? structuredClone(this.withDerivedCompletion(task)) : undefined;
  }
  listRuns(taskId: string) {
    return structuredClone(this.runs.filter((run) => run.taskId === taskId));
  }

  async replace(value: unknown) {
    if (!Array.isArray(value) || !value.every(isTask)) throw new Error("Automation 配置无效");
    this.value = structuredClone(value);
    await this.saveTasks();
    return this.list();
  }

  async createTask(task: AutomationTask) {
    if (!isTask(task)) throw new Error("Automation 配置无效");
    if (this.value.some((item) => item.id === task.id))
      throw new Error("Automation 任务 ID 已存在");
    this.value = [structuredClone(task), ...this.value];
    await this.saveTasks();
    return structuredClone(task);
  }

  async remove(id: string) {
    this.value = this.value.filter((item) => item.id !== id);
    await this.saveTasks();
    return this.list();
  }

  async updateTask(id: string, patch: Partial<AutomationTask>) {
    const index = this.value.findIndex((task) => task.id === id);
    if (index < 0) return undefined;
    const next = { ...this.value[index], ...patch, updatedAt: new Date().toISOString() };
    if (!isTask(next)) throw new Error("Automation 配置无效");
    this.value[index] = next;
    await this.saveTasks();
    return structuredClone(this.value[index]);
  }

  async createRun(input: Omit<AutomationRun, "id">) {
    const run = { ...input, id: randomUUID() };
    this.runs = [run, ...this.runs];
    await this.saveRuns();
    return structuredClone(run);
  }

  private withDerivedCompletion(task: AutomationTask) {
    if (task.completedAt || task.scheduleMode !== "once" || task.enabled) return task;
    const run = this.runs.find(
      (item) =>
        item.taskId === task.id &&
        item.source === "scheduled" &&
        ["success", "failed", "skipped"].includes(item.status),
    );
    return run ? { ...task, completedAt: run.finishedAt ?? run.startedAt } : task;
  }

  async updateRun(id: string, patch: Partial<AutomationRun>) {
    const index = this.runs.findIndex((run) => run.id === id);
    if (index < 0) return undefined;
    this.runs[index] = { ...this.runs[index], ...patch };
    await this.saveRuns();
    return structuredClone(this.runs[index]);
  }

  private async saveTasks() {
    await this.enqueue(async () => {
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(this.value, null, 2), "utf8");
      await rename(temporary, this.file);
    });
  }

  private async saveRuns() {
    await this.enqueue(async () => {
      const temporary = `${this.runsFile}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(this.runs, null, 2), "utf8");
      await rename(temporary, this.runsFile);
    });
  }

  private async enqueue(operation: () => Promise<void>) {
    const next = this.writeQueue.catch(() => undefined).then(operation);
    this.writeQueue = next;
    await next;
  }
}

export type AutomationExecutor = (
  task: AutomationTask,
  source: "manual" | "scheduled",
) => Promise<{ output?: string }>;

export class AutomationScheduler {
  private readonly jobs = new Map<string, Cron>();
  private readonly queues = new Map<string, Promise<void>>();
  private readonly store: AutomationStore;
  private readonly executeTask: AutomationExecutor;

  constructor(store: AutomationStore, executeTask: AutomationExecutor) {
    this.store = store;
    this.executeTask = executeTask;
  }

  start() {
    this.sync();
  }
  stop() {
    for (const job of this.jobs.values()) job.stop();
    this.jobs.clear();
  }

  sync() {
    const tasks = this.store.list();
    const ids = new Set(tasks.map((task) => task.id));
    for (const [id, job] of this.jobs)
      if (!ids.has(id)) {
        job.stop();
        this.jobs.delete(id);
      }
    for (const task of tasks) {
      this.jobs.get(task.id)?.stop();
      this.jobs.delete(task.id);
      if (!task.enabled) continue;
      if (task.scheduleMode === "once" && Date.parse(task.startAt) <= Date.now()) {
        void this.markExpiredOnce(task);
        continue;
      }
      const job =
        task.scheduleMode === "once"
          ? new Cron(
              new Date(task.startAt),
              { maxRuns: 1, catch: true },
              () => void this.enqueue(task, "scheduled"),
            )
          : new Cron(
              "* * * * * *",
              {
                startAt: new Date(task.startAt),
                interval: task.intervalMinutes * 60,
                catch: true,
              },
              () => void this.enqueue(task, "scheduled"),
            );
      this.jobs.set(task.id, job);
    }
  }

  async runNow(id: string) {
    const task = this.store.list().find((item) => item.id === id);
    if (!task) throw new Error("Automation 任务不存在");
    await this.enqueue(task, "manual");
  }

  private enqueue(task: AutomationTask, source: "manual" | "scheduled") {
    const previous = this.queues.get(task.id) ?? Promise.resolve();
    const next = previous
      .then(() => this.run(task, source))
      .finally(() => {
        if (this.queues.get(task.id) === next) this.queues.delete(task.id);
      });
    this.queues.set(task.id, next);
    return next;
  }

  private async run(task: AutomationTask, source: "manual" | "scheduled") {
    const run = await this.store.createRun({
      taskId: task.id,
      source,
      ...(source === "scheduled" && task.scheduleMode === "once"
        ? { scheduledFor: task.startAt }
        : {}),
      startedAt: new Date().toISOString(),
      status: "queued",
    });
    try {
      await this.store.updateRun(run.id, { status: "running" });
      const result = await this.executeTask(task, source);
      await this.store.updateRun(run.id, {
        status: "success",
        output: result.output,
        finishedAt: new Date().toISOString(),
      });
      if (source === "scheduled" && task.scheduleMode === "once") {
        await this.store.updateTask(task.id, {
          enabled: false,
          completedAt: new Date().toISOString(),
        });
        this.sync();
      }
    } catch (error) {
      await this.store.updateRun(run.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date().toISOString(),
      });
      if (source === "scheduled" && task.scheduleMode === "once") {
        await this.store.updateTask(task.id, {
          enabled: false,
          completedAt: new Date().toISOString(),
        });
        this.sync();
      }
    }
  }

  private async markExpiredOnce(task: AutomationTask) {
    if (this.store.listRuns(task.id).some((run) => run.scheduledFor === task.startAt)) return;
    await this.store.createRun({
      taskId: task.id,
      source: "scheduled",
      scheduledFor: task.startAt,
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      status: "skipped",
      error: "开始时间已过去，任务未执行",
    });
    await this.store.updateTask(task.id, { enabled: false, completedAt: new Date().toISOString() });
  }
}
