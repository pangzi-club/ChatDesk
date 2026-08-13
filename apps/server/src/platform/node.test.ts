import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { test } from "vitest";
import { NodePlatformAdapter } from "./node.ts";

const execFileAsync = promisify(execFile);

test("NodePlatformAdapter keeps file operations inside the workspace", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-platform-"));
  await mkdir(path.join(root, "src"));
  await writeFile(path.join(root, "src", "note.txt"), "hello world", "utf8");
  await writeFile(path.join(root, ".DS_Store"), "system metadata", "utf8");
  const adapter = new NodePlatformAdapter();

  assert.equal(
    (await adapter.listDir(root)).entries.some((entry) => entry.name === ".DS_Store"),
    false,
  );
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
  assert.equal(result.summary, null);
});

test("NodePlatformAdapter reports Git line changes and file diff", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-platform-git-diff-"));
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(path.join(root, "note.txt"), "one\ntwo\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: root });
  await writeFile(path.join(root, "note.txt"), "one\nchanged\nthree\n", "utf8");
  await writeFile(path.join(root, "new.txt"), "new line\n", "utf8");
  const adapter = new NodePlatformAdapter();
  const info = await adapter.inspectGit(root);
  assert.equal(info.summary?.filesChanged, 2);
  assert.deepEqual(
    info.summary?.files.map((file) => [file.path, file.status]),
    [
      ["note.txt", "modified"],
      ["new.txt", "untracked"],
    ],
  );
  assert.equal(info.summary?.insertions, 3);
  assert.equal(info.summary?.deletions, 1);
  const diff = await adapter.readGitDiff(root, "note.txt");
  assert.match(diff.content, /changed/);
  assert.equal(diff.additions, 2);
  assert.equal(diff.originalContent, "one\ntwo\n");
  assert.equal(diff.modifiedContent, "one\nchanged\nthree\n");
  const untrackedDiff = await adapter.readGitDiff(root, "new.txt");
  assert.equal(untrackedDiff.originalContent, "");
  assert.equal(untrackedDiff.modifiedContent, "new line\n");
});

test("NodePlatformAdapter restores individual and all Git changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-platform-git-restore-"));
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(path.join(root, "tracked.txt"), "before\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: root });
  await writeFile(path.join(root, "tracked.txt"), "changed\n", "utf8");
  await writeFile(path.join(root, "untracked.txt"), "new\n", "utf8");
  const adapter = new NodePlatformAdapter();
  await adapter.restoreGit(root, "tracked.txt");
  assert.equal(await readFile(path.join(root, "tracked.txt"), "utf8"), "before\n");
  assert.equal(
    (await adapter.inspectGit(root)).summary?.files.some((file) => file.path === "tracked.txt"),
    false,
  );
  await adapter.restoreGit(root);
  assert.equal((await adapter.inspectGit(root)).summary?.files.length, 0);
});

test("NodePlatformAdapter commits Git changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-platform-git-commit-"));
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(path.join(root, "note.txt"), "before\n", "utf8");
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: root });
  await writeFile(path.join(root, "note.txt"), "after\n", "utf8");
  const result = await new NodePlatformAdapter().commitGit(root, "update note");
  assert.equal(result.message, "update note");
  assert.equal(result.pushed, false);
  assert.match(result.hash, /^[0-9a-f]{40}$/);
  assert.equal((await new NodePlatformAdapter().inspectGit(root)).summary?.filesChanged, 0);
});

test("NodePlatformAdapter totals Git changes across truncated file lists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-platform-git-many-files-"));
  await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: root });
  await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
  for (let index = 0; index < 201; index += 1) {
    await writeFile(path.join(root, `file-${index}.txt`), "before\n", "utf8");
  }
  await execFileAsync("git", ["add", "."], { cwd: root });
  await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: root });
  for (let index = 0; index < 201; index += 1) {
    await writeFile(path.join(root, `file-${index}.txt`), "after\n", "utf8");
  }

  const summary = (await new NodePlatformAdapter().inspectGit(root)).summary;
  assert.equal(summary?.filesChanged, 201);
  assert.equal(summary?.files.length, 200);
  assert.equal(summary?.insertions, 201);
  assert.equal(summary?.deletions, 201);
  assert.equal(summary?.truncated, true);
});

test("NodePlatformAdapter runs full shell commands with a bounded result", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-platform-shell-"));
  const result = await new NodePlatformAdapter().runShell(root, "printf server", "full");
  assert.equal(result.code, 0);
  assert.equal(result.out, "server");
});
