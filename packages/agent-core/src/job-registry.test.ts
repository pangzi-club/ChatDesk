import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EventHub } from "./events.ts";
import { JobRegistry } from "./job-registry.ts";

async function createRegistry() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-jobs-"));
  const events = new EventHub();
  const registry = new JobRegistry(root, events);
  await registry.initialize();
  return { root, registry };
}

describe("JobRegistry", () => {
  it("starts a job, waits for completion, and reads output with a cursor", async () => {
    const { registry } = await createRegistry();
    const job = await registry.start({
      sessionId: "session-a",
      runId: "run-a",
      command: "printf first; sleep 0.03; printf second",
      cwd: process.cwd(),
      mode: "full",
    });
    expect(job.jobId).toBeTruthy();
    const running = await registry.wait(job.jobId, "session-a", 1);
    expect(["queued", "running", "exited"]).toContain(running.status);
    const done = await registry.wait(job.jobId, "session-a", 2_000);
    expect(done.status).toBe("exited");
    const first = registry.output(job.jobId, "session-a", 0);
    expect(first.output).toContain("first");
    const second = registry.output(job.jobId, "session-a", first.nextCursor);
    expect(second.output).toBe("");
  });

  it("enforces session ownership and persists terminal metadata", async () => {
    const { root, registry } = await createRegistry();
    const job = await registry.start({
      sessionId: "session-a",
      command: "sleep 2",
      cwd: process.cwd(),
      mode: "full",
    });
    await expect(registry.get(job.jobId, "session-b")).rejects.toThrow("无权访问");
    const stopped = await registry.stop(job.jobId, "session-a");
    expect(stopped.status).toBe("stopped");
    const meta = JSON.parse(
      await readFile(path.join(root, "jobs", job.jobId, "meta.json"), "utf8"),
    ) as { status: string };
    expect(meta.status).toBe("stopped");
  });

  it("stops a waited job when the tool abort signal fires", async () => {
    const { registry } = await createRegistry();
    const job = await registry.start({
      sessionId: "session-a",
      command: "sleep 30",
      cwd: process.cwd(),
      mode: "full",
    });
    const controller = new AbortController();
    const startedAt = Date.now();
    setTimeout(() => controller.abort(), 30);

    const stopped = await registry.wait(job.jobId, "session-a", 120_000, controller.signal);

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(stopped.status).toBe("stopped");
  });

  it("stops all active jobs belonging to a run", async () => {
    const { registry } = await createRegistry();
    const first = await registry.start({
      sessionId: "session-a",
      runId: "run-a",
      command: "sleep 30",
      cwd: process.cwd(),
      mode: "full",
    });
    const second = await registry.start({
      sessionId: "session-a",
      runId: "run-a",
      command: "sleep 30",
      cwd: process.cwd(),
      mode: "full",
    });

    await registry.stopRun("run-a");

    expect((await registry.get(first.jobId, "session-a")).status).toBe("stopped");
    expect((await registry.get(second.jobId, "session-a")).status).toBe("stopped");
  });

  it("marks persisted running jobs as interrupted on restart", async () => {
    const { root, registry } = await createRegistry();
    const job = await registry.start({
      sessionId: "session-a",
      command: "sleep 2",
      cwd: process.cwd(),
      mode: "full",
    });
    const existing = JSON.parse(
      await readFile(path.join(root, "jobs", job.jobId, "meta.json"), "utf8"),
    ) as Record<string, unknown>;
    await registry.stop(job.jobId, "session-a");
    existing.status = "running";
    await writeFile(
      path.join(root, "jobs", job.jobId, "meta.json"),
      JSON.stringify(existing),
      "utf8",
    );
    const restarted = new JobRegistry(root, new EventHub());
    await restarted.initialize();
    expect((await restarted.get(job.jobId, "session-a")).status).toBe("interrupted");
  });
});
