import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type ActivityLogLevel = "info" | "success" | "warning" | "error";
export type ActivityLog = {
  id: string;
  timestamp: string;
  level: ActivityLogLevel;
  source: string;
  message: string;
  details?: string;
};

function isLog(value: unknown): value is ActivityLog {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ActivityLog>;
  return (
    typeof item.id === "string" &&
    typeof item.timestamp === "string" &&
    ["info", "success", "warning", "error"].includes(item.level ?? "") &&
    typeof item.source === "string" &&
    typeof item.message === "string"
  );
}

export class ActivityLogStore {
  private readonly file: string;
  private value: ActivityLog[] = [];

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "activity-logs.json");
  }

  async init() {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      this.value = Array.isArray(parsed) ? parsed.filter(isLog).slice(0, 500) : [];
    } catch {
      this.value = [];
    }
  }

  list() {
    return structuredClone(this.value);
  }

  async append(input: Omit<ActivityLog, "id" | "timestamp">) {
    const next: ActivityLog = { ...input, id: randomUUID(), timestamp: new Date().toISOString() };
    this.value = [next, ...this.value].slice(0, 500);
    await this.save();
    return structuredClone(next);
  }

  async clear() {
    this.value = [];
    await this.save();
  }

  private async save() {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2), "utf8");
    await rename(temporary, this.file);
  }
}
