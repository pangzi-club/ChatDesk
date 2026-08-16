import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME } from "@chatdesk/shared";
import { afterEach, describe, it } from "vitest";
import {
  defaultTasksRoot,
  isPathInside,
  resolveWorkspaceFsRoot,
  taskCwdFor,
  WorkspaceStore,
} from "./workspace-store.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function createStore(suffix = "chat-server") {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chatdesk-workspace-store-"));
  directories.push(parent);
  const dataDir = path.join(parent, suffix);
  await mkdir(dataDir, { recursive: true });
  const store = new WorkspaceStore(dataDir);
  await store.init();
  return { parent, dataDir, store };
}

describe("WorkspaceStore default tasks", () => {
  it("places tasks next to a chat-server data directory", () => {
    assert.equal(
      defaultTasksRoot("/Users/demo/.chatdesk/chat-server"),
      path.join("/Users/demo/.chatdesk", "tasks"),
    );
  });

  it("keeps tasks inside test data directories that are not named chat-server", () => {
    const dataDir = "/tmp/chatdesk-chat-server-abc";
    assert.equal(defaultTasksRoot(dataDir), path.join(dataDir, "tasks"));
  });

  it("treats a path as inside its root, including the root itself", () => {
    const root = path.join(os.tmpdir(), "tasks-root");
    assert.equal(isPathInside(root, root), true);
    assert.equal(isPathInside(path.join(root, "session-1"), root), true);
    assert.equal(isPathInside(path.join(root, "..", "other"), root), false);
  });

  it("resolves workspace file roots to a session cwd inside the workspace", () => {
    const root = path.join(os.tmpdir(), "tasks-root");
    const sessionCwd = path.join(root, "session-1");
    assert.equal(resolveWorkspaceFsRoot(root), path.resolve(root));
    assert.equal(resolveWorkspaceFsRoot(root, sessionCwd), path.resolve(sessionCwd));
    assert.throws(() => resolveWorkspaceFsRoot(root, path.join(root, "..", "other")), /cwd/);
  });

  it("registers a default workspace and creates per-session directories", async () => {
    const { parent, dataDir, store } = await createStore();
    const workspace = await store.ensureDefault();
    assert.equal(workspace.id, DEFAULT_WORKSPACE_ID);
    assert.equal(workspace.name, DEFAULT_WORKSPACE_NAME);
    assert.equal(workspace.path, path.join(parent, "tasks"));

    const first = await store.ensureTaskCwd("session-a");
    const second = await store.ensureTaskCwd("session-b");
    assert.equal(first, taskCwdFor(workspace.path, "session-a"));
    assert.equal(second, taskCwdFor(workspace.path, "session-b"));
    assert.notEqual(first, second);

    const persisted = JSON.parse(
      await readFile(path.join(dataDir, "workspaces.json"), "utf8"),
    ) as Array<{
      id: string;
    }>;
    assert.equal(
      persisted.some((item) => item.id === DEFAULT_WORKSPACE_ID),
      true,
    );
  });

  it("reuses an existing default workspace", async () => {
    const { store } = await createStore();
    const first = await store.ensureDefault();
    const second = await store.ensureDefault();
    assert.equal(second.id, first.id);
    assert.equal(second.path, first.path);
  });

  it("binds default sessions to their own cwd and project sessions to the workspace path", async () => {
    const { store, dataDir } = await createStore();
    await store.ensureDefault();
    const project = await store.add({ path: dataDir, name: "app" });
    const task = await store.bindSession("task-1");
    assert.equal(task.workspaceId, DEFAULT_WORKSPACE_ID);
    assert.equal(task.cwd, store.taskCwdForSession("task-1"));
    const bound = await store.bindSession("project-1", project.id);
    assert.equal(bound.workspaceId, project.id);
    assert.equal(bound.cwd, project.path);
  });

  it("rejects deleting the default workspace", async () => {
    const { store } = await createStore();
    await store.ensureDefault();
    await assert.rejects(store.remove(DEFAULT_WORKSPACE_ID), /不能删除 Default workspace/);
    assert.ok(store.get(DEFAULT_WORKSPACE_ID));
  });
});
