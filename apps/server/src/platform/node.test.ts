import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NodePlatformAdapter } from "./node.ts";

test("NodePlatformAdapter keeps file operations inside the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-platform-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "note.txt"), "hello world", "utf8");
  const adapter = new NodePlatformAdapter();

  assert.deepEqual((await adapter.readFile(root, "src/note.txt")).content, "hello world");
  await adapter.editFile(root, "src/note.txt", "world", "server");
  assert.deepEqual((await adapter.searchFiles(root, { query: "server" })).matches, [
    "src/note.txt",
  ]);
  await assert.rejects(() => adapter.readFile(root, "../outside.txt"), /当前 workspace/);
  await assert.rejects(() => adapter.listDir(root, "src/../.."), /当前 workspace/);
});

test("NodePlatformAdapter reports non-git directories without failing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-platform-git-"));
  const result = await new NodePlatformAdapter().inspectGit(root);
  assert.equal(result.pathExists, true);
  assert.equal(result.isRepository, false);
  assert.deepEqual(result.commits, []);
});

test("NodePlatformAdapter runs full shell commands with a bounded result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-platform-shell-"));
  const result = await new NodePlatformAdapter().runShell(root, "printf server", "full");
  assert.equal(result.code, 0);
  assert.equal(result.out, "server");
});
