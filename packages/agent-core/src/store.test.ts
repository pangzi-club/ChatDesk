import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import type { ChatSession } from "./protocol.ts";
import { SESSION_MESSAGES_FILE, SESSION_META_FILE } from "./session-jsonl.ts";
import { SessionStore } from "./store.ts";

function message(id: string, text: string) {
  return { id, role: "user" as const, parts: [{ type: "text" as const, text }] };
}

function session(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    schemaVersion: 2,
    id: "session-1",
    title: "Test",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [],
    attachments: [],
    ...overrides,
  };
}

async function createStore() {
  const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-session-store-"));
  const store = new SessionStore(root);
  await store.init();
  return { root, store };
}

async function readMessages(root: string, id: string) {
  return readFile(path.join(root, "sessions", id, SESSION_MESSAGES_FILE), "utf8");
}

test("filters and limits the session index by recent title matches", async () => {
  const { store } = await createStore();
  await Promise.all([
    store.save(
      session({
        id: "older-design",
        title: "Design notes",
        updatedAt: "2026-01-01T00:00:01.000Z",
      }),
    ),
    store.save(
      session({
        id: "newer-design",
        title: "DESIGN review",
        updatedAt: "2026-01-01T00:00:03.000Z",
      }),
    ),
    store.save(
      session({
        id: "unrelated",
        title: "Release checklist",
        updatedAt: "2026-01-01T00:00:04.000Z",
      }),
    ),
  ]);

  const matches = await store.list(new Map(), new Map(), { query: "design", limit: 1 });
  assert.deepEqual(
    matches.map((item) => item.id),
    ["newer-design"],
  );
});

test("matches session search against title and user message text, not cwd", async () => {
  const { store } = await createStore();
  await Promise.all([
    store.save(
      session({
        id: "title-hit",
        title: "成就系统",
        cwd: "/tmp/other",
        messages: [message("m1", "hello")],
        updatedAt: "2026-01-01T00:00:01.000Z",
      }),
    ),
    store.save(
      session({
        id: "message-hit",
        title: "Daily notes",
        cwd: "/tmp/other",
        messages: [message("m1", "讨论成就解锁")],
        updatedAt: "2026-01-01T00:00:03.000Z",
      }),
    ),
    store.save(
      session({
        id: "workspace-only",
        title: "查看依赖",
        cwd: "/Users/bohaowang/Workspace/App/niuma2",
        messages: [message("m1", "hello")],
        updatedAt: "2026-01-01T00:00:01.000Z",
      }),
    ),
  ]);

  const matches = await store.list(new Map(), new Map(), { query: "成就" });
  assert.deepEqual(
    matches.map((item) => item.id),
    ["title-hit", "message-hit"],
  );
  assert.equal(
    matches.every((item) => typeof item.searchRelevance === "number"),
    true,
  );
  const limitedMatches = await store.list(new Map(), new Map(), { query: "成就", limit: 1 });
  assert.deepEqual(
    limitedMatches.map((item) => item.id),
    ["title-hit"],
  );
  const recents = await store.list(new Map(), new Map(), { limit: 1 });
  assert.equal(recents[0]?.searchRelevance, undefined);
  const workspaceHits = await store.list(new Map(), new Map(), { query: "niuma" });
  assert.deepEqual(
    workspaceHits.map((item) => item.id),
    [],
  );
});

test("appends a message without rewriting earlier jsonl lines", async () => {
  const { root, store } = await createStore();
  const first = message("m1", "one");
  const second = message("m2", "two");
  await store.save(session({ messages: [first] }));
  const before = await readMessages(root, "session-1");
  await store.save(
    session({
      updatedAt: "2026-01-01T00:00:01.000Z",
      messages: [first, second],
    }),
  );
  const after = await readMessages(root, "session-1");
  assert.equal(after.startsWith(before), true);
  assert.equal(after, `${JSON.stringify(first)}\n${JSON.stringify(second)}\n`);
  const loaded = await store.get("session-1");
  assert.deepEqual(
    loaded?.messages.map((item) => item.id),
    ["m1", "m2"],
  );
});

test("replaces only the last jsonl line when the last message changes", async () => {
  const { root, store } = await createStore();
  const first = message("m1", "one");
  const draft = message("m2", "draft");
  const next = message("m2", "done");
  await store.save(session({ messages: [first, draft] }));
  const before = await readMessages(root, "session-1");
  await store.save(session({ messages: [first, next] }));
  const after = await readMessages(root, "session-1");
  const firstLine = `${JSON.stringify(first)}\n`;
  assert.equal(before.startsWith(firstLine), true);
  assert.equal(after.startsWith(firstLine), true);
  assert.equal(after.split("\n").filter(Boolean).length, 2);
  assert.equal(after, `${firstLine}${JSON.stringify(next)}\n`);
});

test("keeps messages.jsonl unchanged when only the title changes", async () => {
  const { root, store } = await createStore();
  await store.save(session({ messages: [message("m1", "one")] }));
  const before = await readMessages(root, "session-1");
  await store.save(
    session({
      title: "Renamed",
      updatedAt: "2026-01-01T00:00:01.000Z",
      messages: [message("m1", "one")],
    }),
  );
  assert.equal(await readMessages(root, "session-1"), before);
  const loaded = await store.get("session-1");
  assert.equal(loaded?.title, "Renamed");
});

test("rewrites messages.jsonl when a middle message changes", async () => {
  const { store } = await createStore();
  const first = message("m1", "one");
  const middle = message("m2", "two");
  const last = message("m3", "three");
  await store.save(session({ messages: [first, middle, last] }));
  const updatedMiddle = message("m2", "changed");
  await store.save(session({ messages: [first, updatedMiddle, last] }));
  const loaded = await store.get("session-1");
  assert.deepEqual(
    loaded?.messages.map((item) => ("text" in item.parts[0] ? item.parts[0].text : "")),
    ["one", "changed", "three"],
  );
});

test("ignores a truncated last jsonl line", async () => {
  const { root, store } = await createStore();
  const first = message("m1", "one");
  await store.save(session({ messages: [first] }));
  const messagesFile = path.join(root, "sessions", "session-1", SESSION_MESSAGES_FILE);
  await writeFile(messagesFile, `${JSON.stringify(first)}\n{"id":"m2",`, "utf8");
  const loaded = await store.get("session-1");
  assert.deepEqual(
    loaded?.messages.map((item) => item.id),
    ["m1"],
  );
});

test("returns null when a middle jsonl line is corrupt", async () => {
  const { root, store } = await createStore();
  const first = message("m1", "one");
  const last = message("m3", "three");
  await store.save(session({ messages: [first, message("m2", "two"), last] }));
  const messagesFile = path.join(root, "sessions", "session-1", SESSION_MESSAGES_FILE);
  await writeFile(
    messagesFile,
    `${JSON.stringify(first)}\nnot-json\n${JSON.stringify(last)}\n`,
    "utf8",
  );
  assert.equal(await store.get("session-1"), null);
});

test("does not read leftover session.json", async () => {
  const { root, store } = await createStore();
  const directory = path.join(root, "sessions", "session-1");
  await mkdir(directory, { recursive: true });
  await writeFile(
    path.join(directory, "session.json"),
    JSON.stringify(session({ title: "Legacy", messages: [message("legacy", "old")] })),
    "utf8",
  );
  assert.equal(await store.get("session-1"), null);
  await store.save(session({ title: "Current", messages: [message("m1", "one")] }));
  await writeFile(
    path.join(directory, "session.json"),
    JSON.stringify(session({ title: "Stale", messages: [message("stale", "nope")] })),
    "utf8",
  );
  const loaded = await store.get("session-1");
  assert.equal(loaded?.title, "Current");
  assert.deepEqual(
    loaded?.messages.map((item) => item.id),
    ["m1"],
  );
  const meta = JSON.parse(await readFile(path.join(directory, SESSION_META_FILE), "utf8")) as {
    messages?: unknown;
  };
  assert.equal(meta.messages, undefined);
});
