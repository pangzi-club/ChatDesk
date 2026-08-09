import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createChatServer } from "./app.ts";
import type { ServerConfig } from "./config.ts";
import { RunJournal } from "./run-journal.ts";
import { SessionStore } from "./store.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function createTestServer() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "m-dashboard-chat-server-"));
  temporaryDirectories.push(dataDir);
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 14317,
    dataDir,
    token: "test-token",
    version: "test",
  };
  return createChatServer(config);
}

function auth() {
  return { Authorization: "Bearer test-token" };
}

describe("chat server", () => {
  it("exposes health without authentication and protects API routes", async () => {
    const server = await createTestServer();
    const health = await server.app.request("http://localhost/health");
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).ok, true);

    const sessions = await server.app.request("http://localhost/v1/sessions");
    assert.equal(sessions.status, 401);

    const reviews = await server.app.request("http://localhost/v1/sandbox-reviews", {
      headers: auth(),
    });
    assert.equal(reviews.status, 200);
    assert.deepEqual(await reviews.json(), []);

    const filteredReviews = await server.app.request(
      "http://localhost/v1/sandbox-reviews?sessionId=other-session",
      { headers: auth() },
    );
    assert.equal(filteredReviews.status, 200);
    assert.deepEqual(await filteredReviews.json(), []);
  });

  it("creates, lists, reads and deletes sessions", async () => {
    const server = await createTestServer();
    const created = await server.app.request("http://localhost/v1/sessions", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "session-test", title: "测试会话" }),
    });
    assert.equal(created.status, 201);
    assert.equal((await created.json()).title, "测试会话");

    const list = await server.app.request("http://localhost/v1/sessions", { headers: auth() });
    assert.equal(list.status, 200);
    assert.equal((await list.json()).length, 1);

    const read = await server.app.request("http://localhost/v1/sessions/session-test", {
      headers: auth(),
    });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).id, "session-test");

    const deleted = await server.app.request("http://localhost/v1/sessions/session-test", {
      method: "DELETE",
      headers: auth(),
    });
    assert.equal(deleted.status, 204);
    assert.equal((await server.store.get("session-test")), null);
  });

  it("persists a pending port change for the next restart", async () => {
    const server = await createTestServer();
    const response = await server.app.request("http://localhost/v1/config", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ port: 14318 }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      host: "127.0.0.1",
      port: 14318,
      restartRequired: true,
    });
  });

  it("imports legacy sessions from both supported layouts", async () => {
    const legacyDir = await mkdtemp(path.join(os.tmpdir(), "m-dashboard-legacy-chat-"));
    temporaryDirectories.push(legacyDir);
    await mkdir(path.join(legacyDir, "sessions", "legacy-session"), { recursive: true });
    await writeFile(
      path.join(legacyDir, "sessions", "legacy-session", "session.json"),
      JSON.stringify({
        schemaVersion: 2,
        id: "legacy-session",
        title: "Legacy",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        messages: [],
        attachments: [],
      }),
    );
    const previous = process.env.CHAT_SERVER_LEGACY_DIRS;
    process.env.CHAT_SERVER_LEGACY_DIRS = legacyDir;
    try {
      const server = await createTestServer();
      assert.equal((await server.store.get("legacy-session"))?.title, "Legacy");
    } finally {
      if (previous === undefined) delete process.env.CHAT_SERVER_LEGACY_DIRS;
      else process.env.CHAT_SERVER_LEGACY_DIRS = previous;
    }
  });

  it("owns chat config, memory and attachments", async () => {
    const server = await createTestServer();
    const config = await server.app.request("http://localhost/v1/chat-config", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKeys: { dataer: "secret" },
        selectedSkillIds: ["skill-a"],
        sandboxMode: "auto",
      }),
    });
    assert.equal(config.status, 200);
    assert.deepEqual((await config.json()).apiKeys, { dataer: "secret" });

    const loadedConfig = await server.app.request("http://localhost/v1/chat-config", {
      headers: auth(),
    });
    assert.equal((await loadedConfig.json()).sandboxMode, "auto");

    const memory = await server.app.request("http://localhost/v1/memory", {
      method: "PUT",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ schemaVersion: 1, enabled: true, items: [{ id: "m1", content: "事实" }] }),
    });
    assert.equal(memory.status, 200);

    await server.app.request("http://localhost/v1/sessions", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "attachment-session" }),
    });
    const attachment = await server.app.request("http://localhost/v1/sessions/attachment-session/attachments", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "file-1", fileName: "note.txt", base64: Buffer.from("hello").toString("base64") }),
    });
    assert.equal(attachment.status, 201);
    const downloaded = await server.app.request("http://localhost/v1/sessions/attachment-session/attachments/file-1", { headers: auth() });
    assert.equal(await downloaded.text(), "hello");
  });

  it("persists a reviewer model only while that model is configured", async () => {
    const server = await createTestServer();
    const model = {
      id: "reviewer-model",
      name: "reviewer-model",
      baseUrl: "https://example.com/v1",
    };
    const saved = await server.app.request("http://localhost/v1/chat-config", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        models: [model],
        approvalReviewerModelId: model.id,
      }),
    });
    assert.equal(saved.status, 200);
    assert.equal((await saved.json()).approvalReviewerModelId, model.id);

    const removed = await server.app.request("http://localhost/v1/chat-config", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ models: [] }),
    });
    assert.equal((await removed.json()).approvalReviewerModelId, undefined);
  });

  it("recovers interrupted runs as errored sessions", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "m-dashboard-recovery-"));
    temporaryDirectories.push(dataDir);
    const store = new SessionStore(dataDir);
    await store.init();
    await store.save({
      schemaVersion: 2,
      id: "recovered-session",
      title: "Interrupted",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [],
      attachments: [],
    });
    const journal = new RunJournal(dataDir);
    await journal.begin({
      sessionId: "recovered-session",
      runId: "run-recovered",
      startedAt: "2026-01-01T00:00:00.000Z",
    });

    const server = await createChatServer({
      host: "127.0.0.1",
      port: 14317,
      dataDir,
      token: "test-token",
      version: "test",
    });
    const sessions = await server.app.request("http://localhost/v1/sessions", {
      headers: auth(),
    });
    assert.equal((await sessions.json())[0]?.status, "error");
    assert.deepEqual(await journal.recover(), []);
  });
});
