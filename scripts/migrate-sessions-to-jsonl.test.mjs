import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { migrateSessionDirectory, sessionJsonToFiles } from "./migrate-sessions-to-jsonl.mjs";

const execFileAsync = promisify(execFile);
const script = path.resolve("scripts/migrate-sessions-to-jsonl.mjs");

function sampleSession(overrides = {}) {
  return {
    schemaVersion: 2,
    id: "session-1",
    title: "Legacy",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [{ id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] }],
    attachments: [],
    ...overrides,
  };
}

async function writeLegacySession(target, session = sampleSession()) {
  const directory = path.join(target, "sessions", session.id);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "session.json"), JSON.stringify(session, null, 2));
  return directory;
}

test("sessionJsonToFiles splits meta and message lines", () => {
  const session = sampleSession();
  const files = sessionJsonToFiles(session);
  const meta = JSON.parse(files.metaText);
  assert.equal(meta.messages, undefined);
  assert.equal(meta.title, "Legacy");
  assert.equal(files.jsonl, `${JSON.stringify(session.messages[0])}\n`);
});

test("dry-run does not write new files or delete session.json", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migrate-jsonl-"));
  const directory = await writeLegacySession(target);
  const result = await migrateSessionDirectory(directory, false);
  assert.equal(result.status, "would-migrate");
  await stat(path.join(directory, "session.json"));
  await assert.rejects(stat(path.join(directory, "meta.json")));
  await assert.rejects(stat(path.join(directory, "messages.jsonl")));
});

test("apply writes meta.json and messages.jsonl then deletes session.json", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migrate-jsonl-"));
  const directory = await writeLegacySession(target);
  await execFileAsync(process.execPath, [script, "--target", target, "--apply"]);
  const meta = JSON.parse(await readFile(path.join(directory, "meta.json"), "utf8"));
  const jsonl = await readFile(path.join(directory, "messages.jsonl"), "utf8");
  assert.equal(meta.title, "Legacy");
  assert.equal(meta.messages, undefined);
  assert.equal(
    jsonl,
    `${JSON.stringify({ id: "m1", role: "user", parts: [{ type: "text", text: "hello" }] })}\n`,
  );
  await assert.rejects(stat(path.join(directory, "session.json")));
});

test("skips directories that already have meta.json and messages.jsonl", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migrate-jsonl-"));
  const directory = await writeLegacySession(target, sampleSession({ title: "Original" }));
  await writeFile(path.join(directory, "meta.json"), JSON.stringify({ title: "Existing" }));
  await writeFile(path.join(directory, "messages.jsonl"), "");
  const result = await migrateSessionDirectory(directory, true);
  assert.equal(result.status, "skipped");
  const meta = JSON.parse(await readFile(path.join(directory, "meta.json"), "utf8"));
  assert.equal(meta.title, "Existing");
  await stat(path.join(directory, "session.json"));
});

test("fails on invalid session.json without writing new files", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "chatdesk-migrate-jsonl-"));
  const directory = path.join(target, "sessions", "session-1");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "session.json"), "{not json");
  await assert.rejects(migrateSessionDirectory(directory, true), /非法 JSON/);
  await assert.rejects(stat(path.join(directory, "meta.json")));
  await stat(path.join(directory, "session.json"));

  await writeFile(path.join(directory, "session.json"), JSON.stringify({ id: "session-1" }));
  await assert.rejects(migrateSessionDirectory(directory, true), /不是有效的 ChatSession/);
});
