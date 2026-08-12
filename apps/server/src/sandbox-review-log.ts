import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ChatTokenUsage } from "@chatdesk/shared";
import type { SandboxBoundaryReason } from "./sandbox-boundary-reviewer.ts";

const REVIEW_LOG_FILE = "sandbox-review-log.json";

export type SandboxReviewLogDecision = "approve" | "deny" | "user-approval";

export type SandboxReviewLogEntry = {
  id: string;
  timestamp: string;
  sessionId?: string;
  runId?: string;
  toolCallId?: string;
  toolName?: string;
  command?: string;
  input?: Record<string, unknown>;
  reasons: SandboxBoundaryReason[];
  decision: SandboxReviewLogDecision;
  rationale?: string;
  reason?: string;
  modelId?: string;
  durationMs?: number;
  usage?: ChatTokenUsage;
  error?: string;
};

function isEntry(value: unknown): value is SandboxReviewLogEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SandboxReviewLogEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.timestamp === "string" &&
    Array.isArray(entry.reasons) &&
    entry.reasons.every((reason) =>
      ["external-path", "external-cwd", "network", "ambiguous-shell", "sandbox-denied"].includes(
        reason,
      ),
    ) &&
    ["approve", "deny", "user-approval"].includes(entry.decision ?? "")
  );
}

export class SandboxReviewLogStore {
  private readonly file: string;
  private entries: SandboxReviewLogEntry[] = [];
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.file = path.join(dataDir, REVIEW_LOG_FILE);
  }

  async init() {
    this.entries = await readFile(this.file, "utf8")
      .then((value) => {
        const parsed: unknown = JSON.parse(value);
        return Array.isArray(parsed)
          ? parsed.filter(isEntry).sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          : [];
      })
      .catch(() => []);
  }

  list() {
    return this.entries.map((entry) => ({ ...entry, reasons: [...entry.reasons] }));
  }

  async append(entry: Omit<SandboxReviewLogEntry, "id" | "timestamp">) {
    const next: SandboxReviewLogEntry = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };
    this.entries = [next, ...this.entries];
    const write = this.writeQueue.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const temporary = `${this.file}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(this.entries, null, 2), "utf8");
      await rename(temporary, this.file);
    });
    this.writeQueue = write.catch(() => undefined);
    await write;
    return next;
  }
}
