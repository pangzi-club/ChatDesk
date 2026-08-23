import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatPlanSummary } from "./protocol.ts";

const PLAN_NAME_PATTERN = /^plan-([a-z0-9]{8})\.md$/;

function validId(id: string) {
  return /^[a-zA-Z0-9-]{1,128}$/.test(id);
}

function randomVersion() {
  return randomBytes(5).toString("hex").slice(0, 8);
}

function summaryFromEntry(entry: { name: string; createdAt: string; updatedAt: string }) {
  const match = PLAN_NAME_PATTERN.exec(entry.name);
  if (!match) return null;
  return {
    id: match[1],
    fileName: entry.name,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  } satisfies ChatPlanSummary;
}

export class PlanStore {
  private readonly sessionsRoot: string;

  constructor(root: string) {
    this.sessionsRoot = path.join(root, "sessions");
  }

  private directory(sessionId: string) {
    if (!validId(sessionId)) throw new Error("invalid plan session id");
    return path.join(this.sessionsRoot, sessionId);
  }

  private filePath(sessionId: string, planId: string) {
    if (!/^[a-z0-9]{8}$/.test(planId)) throw new Error("invalid plan id");
    return path.join(this.directory(sessionId), `plan-${planId}.md`);
  }

  async create(sessionId: string) {
    const directory = this.directory(sessionId);
    await mkdir(directory, { recursive: true });
    let id = randomVersion();
    while (await stat(this.filePath(sessionId, id)).catch(() => null)) id = randomVersion();
    const now = new Date().toISOString();
    await writeFile(this.filePath(sessionId, id), "", "utf8");
    return {
      id,
      fileName: `plan-${id}.md`,
      createdAt: now,
      updatedAt: now,
    } satisfies ChatPlanSummary;
  }

  async list(sessionId: string) {
    const directory = this.directory(sessionId);
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isFile() && PLAN_NAME_PATTERN.test(entry.name))
        .map(async (entry) => {
          const metadata = await stat(path.join(directory, entry.name));
          return summaryFromEntry({
            name: entry.name,
            createdAt: metadata.birthtime.toISOString(),
            updatedAt: metadata.mtime.toISOString(),
          });
        }),
    );
    return summaries
      .filter((summary): summary is ChatPlanSummary => summary !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async read(sessionId: string, planId: string) {
    const fileName = `plan-${planId}.md`;
    const content = await readFile(this.filePath(sessionId, planId), "utf8");
    const metadata = await stat(this.filePath(sessionId, planId));
    return {
      id: planId,
      fileName,
      content,
      createdAt: metadata.birthtime.toISOString(),
      updatedAt: metadata.mtime.toISOString(),
    };
  }

  async write(sessionId: string, planId: string, content: string) {
    if (content.length > 500_000) throw new Error("计划内容过大");
    const target = this.filePath(sessionId, planId);
    const temporary = `${target}.${process.pid}.tmp`;
    await writeFile(temporary, content, "utf8");
    await rename(temporary, target);
    return this.read(sessionId, planId);
  }
}
