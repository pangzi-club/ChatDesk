import type { ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { ChatJobOutputPage, ChatJobSummary, JobStatus, SandboxMode } from "@chatdesk/shared";
import type { EventHub } from "./events.ts";
import { JobStore } from "./job-store.ts";
import { killProcessTree, spawnSandboxedShell } from "./sandbox-exec.ts";

const MAX_BUFFER_BYTES = 256 * 1024;

type JobRecord = ChatJobSummary & {
  child?: ChildProcess;
  output: string;
  outputStart: number;
  completion: Promise<ChatJobSummary>;
  resolveCompletion: (summary: ChatJobSummary) => void;
  persistence?: Promise<unknown>;
};

export type StartJobInput = {
  sessionId: string;
  runId?: string;
  command: string;
  cwd: string;
  mode: SandboxMode;
  allowOutside?: boolean;
  allowNetwork?: boolean;
  readablePaths?: string[];
  developerToolPaths?: string[];
};

export class JobRegistry {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly persisted = new Map<string, ChatJobSummary>();
  private readonly store: JobStore;
  private readonly events: EventHub;

  constructor(dataDir: string, events: EventHub) {
    this.store = new JobStore(dataDir);
    this.events = events;
  }

  async initialize() {
    await this.store.init();
    for (const summary of await this.store.list()) {
      if (summary.status === "queued" || summary.status === "running") {
        const interrupted: ChatJobSummary = {
          ...summary,
          status: "interrupted",
          endedAt: new Date().toISOString(),
          durationMs: summary.startedAt
            ? Math.max(0, Date.now() - Date.parse(summary.startedAt))
            : undefined,
        };
        await this.store.save(interrupted);
        this.persisted.set(interrupted.jobId, interrupted);
      } else {
        this.persisted.set(summary.jobId, summary);
      }
    }
  }

  async start(input: StartJobInput) {
    const jobId = randomUUID();
    let resolveCompletion!: (summary: ChatJobSummary) => void;
    const completion = new Promise<ChatJobSummary>((resolve) => {
      resolveCompletion = resolve;
    });
    const createdAt = new Date().toISOString();
    const record: JobRecord = {
      jobId,
      sessionId: input.sessionId,
      ...(input.runId ? { runId: input.runId } : {}),
      status: "queued",
      command: input.command,
      cwd: input.cwd,
      createdAt,
      outputBytes: 0,
      output: "",
      outputStart: 0,
      completion,
      resolveCompletion,
    };
    this.jobs.set(jobId, record);
    record.persistence = this.store.save(this.summary(record)).catch(() => undefined);
    await record.persistence;
    this.publish(record, "job.updated");
    try {
      const child = spawnSandboxedShell(input.command, input);
      record.child = child;
      record.status = "running";
      record.startedAt = new Date().toISOString();
      record.persistence = this.store.save(this.summary(record)).catch(() => undefined);
      this.publish(record, "job.updated");
      const append = (chunk: Buffer) => {
        record.outputBytes += chunk.byteLength;
        record.output += chunk.toString();
        if (Buffer.byteLength(record.output) > MAX_BUFFER_BYTES) {
          const bytes = Buffer.from(record.output);
          record.output = bytes.subarray(bytes.length - MAX_BUFFER_BYTES).toString();
          record.outputStart = record.outputBytes - Buffer.byteLength(record.output);
          record.outputTruncated = true;
        }
        this.publish(record, "job.output");
      };
      child.stdout?.on("data", append);
      child.stderr?.on("data", append);
      child.once("error", (error) => this.finish(record, "failed", undefined, undefined, error));
      child.once("close", (code, signal) => {
        const status: JobStatus =
          record.status === "stopped"
            ? "stopped"
            : record.status === "interrupted"
              ? "interrupted"
              : code === 0
                ? "exited"
                : "failed";
        this.finish(record, status, code ?? undefined, signal ?? undefined);
      });
    } catch (error) {
      this.finish(record, "failed", undefined, undefined, error);
    }
    return this.summary(record);
  }

  async wait(jobId: string, sessionId: string, timeoutMs = 0, abortSignal?: AbortSignal) {
    const record = this.jobs.get(jobId);
    if (!record) return this.get(jobId, sessionId);
    this.authorize(jobId, sessionId);
    if (!record.child || this.isTerminal(record.status)) return this.summary(record);
    if (timeoutMs <= 0) return this.summary(record);
    const waiters: Promise<unknown>[] = [
      record.completion,
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, Math.min(timeoutMs, 60_000));
        timer.unref?.();
      }),
    ];
    if (abortSignal) {
      waiters.push(
        new Promise<"aborted">((resolve) => {
          if (abortSignal.aborted) {
            resolve("aborted");
            return;
          }
          abortSignal.addEventListener("abort", () => resolve("aborted"), { once: true });
        }),
      );
    }
    const result = await Promise.race(waiters);
    if (result === "aborted") return this.stop(jobId, sessionId);
    await record.persistence;
    return this.summary(record);
  }

  output(jobId: string, sessionId: string, cursor = 0): ChatJobOutputPage {
    const record = this.jobs.get(jobId);
    if (!record) {
      const summary = this.persisted.get(jobId);
      if (!summary) throw new Error("Job 不存在");
      if (summary.sessionId !== sessionId) throw new Error("无权访问该 Job");
      return {
        jobId,
        status: summary.status,
        output: summary.preview ?? "",
        nextCursor: summary.outputBytes,
        truncated: summary.outputTruncated === true,
        outputBytes: summary.outputBytes,
      };
    }
    this.authorize(jobId, sessionId);
    const start = Math.max(record.outputStart, Math.min(record.outputBytes, Math.max(0, cursor)));
    const offset = start - record.outputStart;
    return {
      jobId,
      status: record.status,
      output: record.output.slice(offset),
      nextCursor: record.outputBytes,
      truncated: record.outputTruncated === true && cursor < record.outputStart,
      outputBytes: record.outputBytes,
    };
  }

  async stop(jobId: string, sessionId: string) {
    const record = this.jobs.get(jobId);
    if (!record) return this.get(jobId, sessionId);
    this.authorize(jobId, sessionId);
    if (!this.isTerminal(record.status)) {
      record.status = "stopped";
      if (record.child) killProcessTree(record.child as never);
      await record.completion;
      await record.persistence;
    }
    return this.summary(record);
  }

  async stopRun(runId: string) {
    const jobs = [...this.jobs.values()].filter(
      (record) => record.runId === runId && !this.isTerminal(record.status),
    );
    await Promise.all(jobs.map((record) => this.stop(record.jobId, record.sessionId)));
  }

  async get(jobId: string, sessionId: string) {
    const record = this.jobs.get(jobId);
    if (record) return this.summary(this.authorize(jobId, sessionId));
    const summary = this.persisted.get(jobId);
    if (!summary) throw new Error("Job 不存在");
    if (summary.sessionId !== sessionId) throw new Error("无权访问该 Job");
    return structuredClone(summary);
  }

  async list(sessionId: string) {
    const live = [...this.jobs.values()].map((record) => this.summary(record));
    const stored = [...this.persisted.values()].filter((summary) => !this.jobs.has(summary.jobId));
    return [...live, ...stored]
      .filter((summary) => !sessionId || summary.sessionId === sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async shutdown() {
    await Promise.all(
      [...this.jobs.values()]
        .filter((record) => !this.isTerminal(record.status))
        .map(async (record) => {
          record.status = "interrupted";
          if (record.child) killProcessTree(record.child as never);
          await record.completion;
        }),
    );
  }

  private authorize(jobId: string, sessionId: string) {
    const record = this.jobs.get(jobId);
    if (!record) throw new Error("Job 不存在");
    if (record.sessionId !== sessionId) throw new Error("无权访问该 Job");
    return record;
  }

  private isTerminal(status: JobStatus) {
    return ["exited", "failed", "stopped", "timed_out", "interrupted"].includes(status);
  }

  private summary(record: JobRecord): ChatJobSummary {
    return {
      ...record,
      child: undefined,
      output: undefined,
      completion: undefined,
      resolveCompletion: undefined,
      persistence: undefined,
    } as unknown as ChatJobSummary;
  }

  private publish(record: JobRecord, type: "job.updated" | "job.output") {
    const summary = this.summary(record);
    this.events.publish({
      type,
      sessionId: record.sessionId,
      ...(record.runId ? { runId: record.runId } : {}),
      job: summary,
      ...(type === "job.output"
        ? { jobOutput: this.output(record.jobId, record.sessionId, record.outputBytes) }
        : {}),
    });
  }

  private finish(
    record: JobRecord,
    status: JobStatus,
    exitCode?: number,
    signal?: string,
    error?: unknown,
  ) {
    if (
      this.isTerminal(record.status) &&
      record.status !== "stopped" &&
      record.status !== "interrupted"
    )
      return;
    record.status = record.status === "interrupted" ? "interrupted" : status;
    record.exitCode = exitCode;
    record.signal = signal;
    record.endedAt = new Date().toISOString();
    record.durationMs = record.startedAt
      ? Math.max(0, Date.parse(record.endedAt) - Date.parse(record.startedAt))
      : 0;
    if (error && !record.preview)
      record.preview = error instanceof Error ? error.message : String(error);
    if (!record.preview && record.output.trim()) record.preview = record.output.slice(-2_000);
    const finalSummary = this.summary(record);
    this.persisted.set(record.jobId, finalSummary);
    record.persistence = this.store.save(finalSummary).catch(() => undefined);
    this.publish(record, "job.updated");
    this.events.publish({
      type: "job.done",
      sessionId: record.sessionId,
      ...(record.runId ? { runId: record.runId } : {}),
      job: this.summary(record),
    });
    record.resolveCompletion(this.summary(record));
  }
}
