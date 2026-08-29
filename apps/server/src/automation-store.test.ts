import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import { AutomationScheduler, AutomationStore, type AutomationTask } from "./automation-store.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
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
});
