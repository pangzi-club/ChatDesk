import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { createChatServer } from "./app.ts";
import type { ServerConfig } from "./config.ts";

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
});
