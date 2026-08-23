import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatJobSummary } from "@chatdesk/shared";

function isJob(value: unknown): value is ChatJobSummary {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ChatJobSummary>;
  return (
    typeof item.jobId === "string" &&
    typeof item.sessionId === "string" &&
    typeof item.status === "string" &&
    typeof item.command === "string" &&
    typeof item.cwd === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.outputBytes === "number"
  );
}

export class JobStore {
  private readonly root: string;
  private readonly tails = new Map<string, Promise<void>>();

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "jobs");
  }

  async init() {
    await mkdir(this.root, { recursive: true });
  }

  async list(): Promise<ChatJobSummary[]> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    const jobs: ChatJobSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const value = await this.read(entry.name);
      if (value) jobs.push(value);
    }
    return jobs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async read(jobId: string) {
    try {
      const value = JSON.parse(await readFile(this.metaPath(jobId), "utf8")) as unknown;
      return isJob(value) ? value : null;
    } catch {
      return null;
    }
  }

  async save(summary: ChatJobSummary) {
    const previous = this.tails.get(summary.jobId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        const directory = path.dirname(this.metaPath(summary.jobId));
        await mkdir(directory, { recursive: true });
        const temporary = `${this.metaPath(summary.jobId)}.${process.pid}.${randomUUID()}.tmp`;
        await writeFile(temporary, JSON.stringify(summary, null, 2), "utf8");
        await rename(temporary, this.metaPath(summary.jobId));
      });
    this.tails.set(summary.jobId, next);
    await next;
    return structuredClone(summary);
  }

  private metaPath(jobId: string) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(jobId)) throw new Error("无效的 job id");
    return path.join(this.root, jobId, "meta.json");
  }
}
