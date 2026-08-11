import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { dedupeSessionMessages } from "./dedupe-chat-sessions.mjs";

const execFileAsync = promisify(execFile);
const script = path.resolve("scripts/dedupe-chat-sessions.mjs");

test("dedupeSessionMessages keeps the stable id for duplicated assistant replies", () => {
  const result = dedupeSessionMessages([
    { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
    { id: "", role: "assistant", parts: [{ type: "text", text: "same" }] },
    { id: "client-1", role: "assistant", parts: [{ type: "text", text: "same" }] },
  ]);

  assert.deepEqual(
    result.messages.map((message) => message.id),
    ["user-1", "client-1"],
  );
  assert.equal(result.removed, 1);
});

test("dedupeSessionMessages merges reasoning parts from a blank-id duplicate", () => {
  const result = dedupeSessionMessages([
    {
      id: "",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "thought" },
        { type: "text", text: "same" },
      ],
    },
    { id: "client-1", role: "assistant", parts: [{ type: "text", text: "same" }] },
  ]);

  assert.equal(result.removed, 1);
  assert.equal(result.assigned, 0);
  assert.deepEqual(result.messages, [
    {
      id: "client-1",
      role: "assistant",
      parts: [
        { type: "reasoning", text: "thought" },
        { type: "text", text: "same" },
      ],
    },
  ]);
});

test("dedupeSessionMessages is idempotent and does not remove a repeated reply after a user turn", () => {
  const messages = [
    { id: "user-1", role: "user", parts: [{ type: "text", text: "one" }] },
    { id: "assistant-1", role: "assistant", parts: [{ type: "text", text: "same" }] },
    { id: "user-2", role: "user", parts: [{ type: "text", text: "two" }] },
    { id: "assistant-2", role: "assistant", parts: [{ type: "text", text: "same" }] },
  ];
  const first = dedupeSessionMessages(messages);
  const second = dedupeSessionMessages(first.messages);

  assert.equal(first.removed, 0);
  assert.deepEqual(second.messages, first.messages);
  assert.equal(second.removed, 0);
});

test("dedupe script applies changes and keeps a backup", async () => {
  const target = await mkdtemp(path.join(os.tmpdir(), "chatdesk-dedupe-target-"));
  const sessionDir = path.join(target, "sessions", "session-1");
  await mkdir(sessionDir, { recursive: true });
  const sessionFile = path.join(sessionDir, "session.json");
  await writeFile(
    sessionFile,
    JSON.stringify({
      schemaVersion: 2,
      id: "session-1",
      title: "Duplicate",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [
        { id: "", role: "assistant", parts: [{ type: "text", text: "same" }] },
        { id: "stable", role: "assistant", parts: [{ type: "text", text: "same" }] },
      ],
      attachments: [],
    }),
  );

  await execFileAsync(process.execPath, [script, "--target", target, "--apply"]);
  const cleaned = JSON.parse(await readFile(sessionFile, "utf8"));
  assert.deepEqual(
    cleaned.messages.map((message) => message.id),
    ["stable"],
  );
  await stat(`${sessionFile}.before-dedupe`);

  const second = await execFileAsync(process.execPath, [script, "--target", target]);
  assert.match(second.stdout, /changed":0/);
});
