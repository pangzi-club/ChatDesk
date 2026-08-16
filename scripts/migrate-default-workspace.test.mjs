import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  defaultTasksRoot,
  isDefaultSessionMeta,
  migrateDefaultWorkspace,
  taskCwdFor,
} from "./migrate-default-workspace.mjs";

const execFileAsync = promisify(execFile);
const script = path.resolve("scripts/migrate-default-workspace.mjs");

function sampleMeta(id, overrides = {}) {
  return {
    schemaVersion: 2,
    id,
    title: id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    attachments: [],
    workspaceId: null,
    cwd: null,
    ...overrides,
  };
}

async function writeSession(target, meta) {
  const directory = path.join(target, "sessions", meta.id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
  await writeFile(path.join(directory, "messages.jsonl"), "");
  return directory;
}

test("identifies empty workspace fields as default sessions", () => {
  assert.equal(isDefaultSessionMeta(sampleMeta("one")), true);
  assert.equal(isDefaultSessionMeta(sampleMeta("one", { workspaceId: "", cwd: "" })), true);
  assert.equal(
    isDefaultSessionMeta(sampleMeta("one", { workspaceId: "alpha", cwd: "/work/alpha" })),
    false,
  );
});

test("dry-run does not write workspaces.json or task directories", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migrate-default-"));
  await writeSession(target, sampleMeta("session-a"));
  await writeSession(target, sampleMeta("session-b"));
  const result = await migrateDefaultWorkspace(target, false);
  assert.equal(result.summary.migrated, 2);
  assert.equal(result.summary.skipped, 0);
  await assert.rejects(stat(path.join(target, "workspaces.json")));
  await assert.rejects(stat(taskCwdFor(defaultTasksRoot(target), "session-a")));
  const meta = JSON.parse(
    await readFile(path.join(target, "sessions", "session-a", "meta.json"), "utf8"),
  );
  assert.equal(meta.workspaceId, null);
  assert.equal(meta.cwd, null);
});

test("apply creates independent task directories and skips project sessions", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migrate-default-parent-"));
  const target = path.join(parent, "chat-server");
  await mkdir(target, { recursive: true });
  await writeSession(target, sampleMeta("session-a"));
  await writeSession(target, sampleMeta("session-b"));
  await writeSession(
    target,
    sampleMeta("project-session", {
      workspaceId: "alpha",
      cwd: "/work/alpha",
    }),
  );

  await execFileAsync(process.execPath, [script, "--target", target, "--apply"]);

  const tasksRoot = path.join(parent, "tasks");
  const left = JSON.parse(
    await readFile(path.join(target, "sessions", "session-a", "meta.json"), "utf8"),
  );
  const right = JSON.parse(
    await readFile(path.join(target, "sessions", "session-b", "meta.json"), "utf8"),
  );
  const project = JSON.parse(
    await readFile(path.join(target, "sessions", "project-session", "meta.json"), "utf8"),
  );
  assert.equal(left.workspaceId, "default");
  assert.equal(right.workspaceId, "default");
  assert.equal(left.cwd, path.join(tasksRoot, "session-a"));
  assert.equal(right.cwd, path.join(tasksRoot, "session-b"));
  assert.notEqual(left.cwd, right.cwd);
  assert.equal(project.workspaceId, "alpha");
  await stat(left.cwd);
  await stat(right.cwd);

  const workspaces = JSON.parse(await readFile(path.join(target, "workspaces.json"), "utf8"));
  assert.equal(workspaces[0].id, "default");
  assert.equal(workspaces[0].path, tasksRoot);
});
