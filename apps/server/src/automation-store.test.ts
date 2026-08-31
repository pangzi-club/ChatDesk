import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, vi } from "vitest";
import { AutomationScheduler, AutomationStore, type AutomationTask } from "./automation-store.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("AutomationScheduler", () => {
  it("executes a future once task and disables it after completion", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "chatdesk-automation-"));
    temporaryDirectories.push(dataDir);
    const store = new AutomationStore(dataDir);
    await store.init();
    const task: AutomationTask = {
      id: "once-task",
      name: "Once task",
      description: "Run once",
      scheduleMode: "once",
      intervalMinutes: 1,
      startAt: new Date(Date.now() + 100).toISOString(),
      agentId: "agent-1",
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await store.replace([task]);
    let executions = 0;
    const scheduler = new AutomationScheduler(store, async () => {
      executions += 1;
      return { output: "done" };
    });

    scheduler.start();
    await new Promise((resolve) => setTimeout(resolve, 500));
    scheduler.stop();

    assert.equal(executions, 1);
    assert.deepEqual(
      store.listRuns(task.id).map((run) => run.status),
      ["success"],
    );
    assert.equal(store.list()[0]?.enabled, false);
    assert.equal(typeof store.list()[0]?.completedAt, "string");
  });

  it("polls interval tasks every minute and catches the latest missed schedule", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-31T02:00:30.000Z");
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "chatdesk-automation-"));
    temporaryDirectories.push(dataDir);
    const store = new AutomationStore(dataDir);
    await store.init();
    const task: AutomationTask = {
      id: "interval-task",
      name: "Interval task",
      description: "Run daily",
      scheduleMode: "interval",
      intervalMinutes: 1_440,
      startAt: "2026-08-30T02:00:00.000Z",
      agentId: "agent-1",
      enabled: true,
      createdAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-30T01:00:00.000Z",
    };
    await store.replace([task]);
    let executions = 0;
    const scheduler = new AutomationScheduler(store, async () => {
      executions += 1;
      return { output: "done" };
    });

    scheduler.start();
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.waitFor(() => assert.equal(store.listRuns(task.id)[0]?.status, "success"));

    assert.equal(executions, 1);
    assert.equal(store.listRuns(task.id)[0]?.scheduledFor, "2026-08-31T02:00:00.000Z");

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    assert.equal(executions, 1);
    scheduler.stop();
  });

  it("keeps an interval task scheduled when another task causes a sync", async () => {
    vi.useFakeTimers();
    vi.setSystemTime("2026-08-31T01:59:30.000Z");
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "chatdesk-automation-"));
    temporaryDirectories.push(dataDir);
    const store = new AutomationStore(dataDir);
    await store.init();
    const intervalTask: AutomationTask = {
      id: "interval-task",
      name: "Interval task",
      description: "Run daily",
      scheduleMode: "interval",
      intervalMinutes: 1_440,
      startAt: "2026-08-30T02:00:00.000Z",
      agentId: "agent-1",
      enabled: true,
      createdAt: "2026-08-30T01:00:00.000Z",
      updatedAt: "2026-08-30T01:00:00.000Z",
    };
    await store.replace([intervalTask]);
    let executions = 0;
    const scheduler = new AutomationScheduler(store, async () => {
      executions += 1;
      return { output: "done" };
    });
    scheduler.start();

    const onceTask: AutomationTask = {
      ...intervalTask,
      id: "once-task",
      name: "Once task",
      description: "Run once later",
      scheduleMode: "once",
      startAt: "2026-08-31T02:30:00.000Z",
      createdAt: "2026-08-31T01:59:40.000Z",
      updatedAt: "2026-08-31T01:59:40.000Z",
    };
    vi.setSystemTime("2026-08-31T01:59:40.000Z");
    await store.replace([onceTask, intervalTask]);
    scheduler.sync();

    await vi.advanceTimersByTimeAsync(20_000);
    await vi.waitFor(() => assert.equal(store.listRuns(intervalTask.id)[0]?.status, "success"));

    assert.equal(executions, 1);
    assert.equal(store.listRuns(intervalTask.id)[0]?.scheduledFor, "2026-08-31T02:00:00.000Z");
    scheduler.stop();
  });
});
