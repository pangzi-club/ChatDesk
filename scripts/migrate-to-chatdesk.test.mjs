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
