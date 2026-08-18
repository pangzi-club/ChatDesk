import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const script = path.resolve("scripts/migrate-to-chatdesk.mjs");

test("migration script is dry-run by default and normalizes legacy layouts", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migration-source-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migration-target-"));
  await mkdir(path.join(fixture, "chat", "legacy-session"), { recursive: true });
  await mkdir(path.join(fixture, "chat-archive", "legacy-archive"), { recursive: true });
  await writeFile(path.join(fixture, "chat", "legacy-session", "session.json"), "session");
  await writeFile(path.join(fixture, "chat-archive", "legacy-archive", "session.json"), "archive");
  await writeFile(path.join(fixture, ".window-state.json"), "window state");

  await execFileAsync(process.execPath, [script, "--source", fixture, "--target", target]);
  await assert.rejects(
    stat(path.join(target, "chat-server", "sessions", "legacy-session", "session.json")),
  );

  await execFileAsync(process.execPath, [
    script,
    "--source",
    fixture,
    "--target",
    target,
    "--apply",
  ]);
  assert.equal(
    await readFile(
      path.join(target, "chat-server", "sessions", "legacy-session", "session.json"),
      "utf8",
    ),
    "session",
  );
  assert.equal(
    await readFile(
      path.join(target, "chat-server", "archive", "sessions", "legacy-archive", "session.json"),
      "utf8",
    ),
    "archive",
  );
  await assert.rejects(stat(path.join(target, "window-state.json")));

  await execFileAsync(process.execPath, [
    script,
    "--source",
    fixture,
    "--target",
    target,
    "--apply",
  ]);
  assert.equal(
    await readFile(
      path.join(target, "chat-server", "sessions", "legacy-session", "session.json"),
      "utf8",
    ),
    "session",
  );
});

test("migration script does not overwrite destination conflicts", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migration-conflict-source-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migration-conflict-target-"));
  await mkdir(path.join(fixture, "chat", "same-session"), { recursive: true });
  await mkdir(path.join(target, "chat-server", "sessions", "same-session"), { recursive: true });
  await writeFile(path.join(fixture, "chat", "same-session", "session.json"), "source");
  await writeFile(
    path.join(target, "chat-server", "sessions", "same-session", "session.json"),
    "target",
  );

  await execFileAsync(process.execPath, [
    script,
    "--source",
    fixture,
    "--target",
    target,
    "--apply",
  ]);
  assert.equal(
    await readFile(
      path.join(target, "chat-server", "sessions", "same-session", "session.json"),
      "utf8",
    ),
    "target",
  );
});

test("migration rollback removes copied files and restores rewritten settings", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migration-rollback-source-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migration-rollback-target-"));
  const copiedSession = path.join(target, "chat-server", "sessions", "new-session", "session.json");
  const existingSession = path.join(
    target,
    "chat-server",
    "sessions",
    "existing-session",
    "session.json",
  );
  const originalSettings = {
    theme: "dark",
    "system-logs": [{ level: "info", message: "legacy" }],
  };

  await mkdir(path.join(fixture, "chat", "new-session"), { recursive: true });
  await mkdir(path.join(fixture, "chat", "existing-session"), { recursive: true });
  await mkdir(path.dirname(existingSession), { recursive: true });
  await writeFile(path.join(fixture, "chat", "new-session", "session.json"), "new");
  await writeFile(path.join(fixture, "chat", "existing-session", "session.json"), "source");
  await writeFile(existingSession, "target");
  await writeFile(path.join(target, "settings.json"), JSON.stringify(originalSettings));

  await execFileAsync(process.execPath, [
    script,
    "--source",
    fixture,
    "--target",
    target,
    "--apply",
  ]);

  assert.equal(await readFile(copiedSession, "utf8"), "new");
  assert.equal(await readFile(existingSession, "utf8"), "target");
  assert.deepEqual(JSON.parse(await readFile(path.join(target, "settings.json"), "utf8")), {
    theme: "dark",
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(target, "system-logs.json"), "utf8")), [
    { level: "info", message: "legacy" },
  ]);

  const manifest = JSON.parse(await readFile(path.join(target, ".migration-v1.json"), "utf8"));
  assert.equal(manifest.status, "applied");
  assert.ok(
    manifest.createdFiles.some((file) => file.path === path.relative(target, copiedSession)),
  );
  assert.equal(manifest.backups.length, 1);

  await execFileAsync(process.execPath, [script, "--target", target, "--rollback"]);

  await assert.rejects(stat(copiedSession));
  assert.equal(await readFile(existingSession, "utf8"), "target");
  assert.deepEqual(
    JSON.parse(await readFile(path.join(target, "settings.json"), "utf8")),
    originalSettings,
  );
  await assert.rejects(stat(path.join(target, "system-logs.json")));
  await assert.rejects(stat(path.join(target, ".migration-v1.json")));
  await assert.rejects(stat(path.join(target, manifest.backupDirectory)));
});

test("migration rollback refuses to delete files changed after migration", async () => {
  const fixture = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migration-changed-source-"));
  const target = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migration-changed-target-"));
  const copiedSession = path.join(
    target,
    "chat-server",
    "sessions",
    "changed-session",
    "session.json",
  );
  await mkdir(path.join(fixture, "chat", "changed-session"), { recursive: true });
  await writeFile(path.join(fixture, "chat", "changed-session", "session.json"), "original");

  await execFileAsync(process.execPath, [
    script,
    "--source",
    fixture,
    "--target",
    target,
    "--apply",
  ]);
  await writeFile(copiedSession, "changed after migration");

  await assert.rejects(
    execFileAsync(process.execPath, [script, "--target", target, "--rollback"]),
    /迁移后文件已被修改/,
  );
  assert.equal(await readFile(copiedSession, "utf8"), "changed after migration");
  await stat(path.join(target, ".migration-v1.json"));
});
