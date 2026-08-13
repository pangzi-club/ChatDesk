import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import { createChatServer } from "./app.ts";
import type { ServerConfig } from "./config.ts";
import type { ChatSession } from "./protocol.ts";
import { RunJournal } from "./run-journal.ts";
import { SessionStore } from "./store.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

async function createTestServer() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "chatdesk-chat-server-"));
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
    assert.equal(await server.store.get("session-test"), null);
  });

  it("previews the system prompt without starting a run", async () => {
    const server = await createTestServer();
    const workspace = await mkdtemp(path.join(os.tmpdir(), "chatdesk-preview-workspace-"));
    temporaryDirectories.push(workspace);
    await writeFile(path.join(workspace, "AGENTS.md"), "只改动源码。", "utf8");
    const registered = await server.app.request("http://localhost/v1/workspaces", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ path: workspace }),
    });
    const project = (await registered.json()) as { id: string };
    const response = await server.app.request(
      "http://localhost/v1/sessions/new-prompt-preview/system-prompt/preview",
      {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId: project.id,
          system: "工具提示",
          memory: "记忆提示",
        }),
      },
    );
    assert.equal(response.status, 200);
    const preview = (await response.json()) as {
      text: string;
      sections: Array<{ id: string; included: boolean }>;
      cwd?: string;
    };
    assert.equal(preview.cwd, await realpath(workspace));
    assert.match(preview.text, /只改动源码。[\s\S]*工具提示[\s\S]*记忆提示/);
    assert.equal(preview.sections.find((section) => section.id === "agents")?.included, true);
    assert.equal(server.runs.activeCount(), 0);
  });

  it("uses the saved prompt snapshot for historical sessions", async () => {
    const server = await createTestServer();
    const workspace = await mkdtemp(path.join(os.tmpdir(), "chatdesk-history-prompt-"));
    temporaryDirectories.push(workspace);
    await writeFile(path.join(workspace, "AGENTS.md"), "当前文件规则", "utf8");
    const created = await server.app.request("http://localhost/v1/sessions", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "historical-prompt" }),
    });
    assert.equal(created.status, 201);
    const historical = await server.store.get("historical-prompt");
    assert.ok(historical);
    await server.store.save({
      ...historical,
      cwd: workspace,
      systemPrompt: {
        text: "保存时的规则",
        sections: [{ id: "agents", label: "AGENTS.md", content: "保存时的规则", included: true }],
        cwd: workspace,
      },
    });

    const response = await server.app.request(
      "http://localhost/v1/sessions/historical-prompt/system-prompt/preview",
      { method: "POST", headers: { ...auth(), "Content-Type": "application/json" }, body: "{}" },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      text: "保存时的规则",
      sections: [{ id: "agents", label: "AGENTS.md", content: "保存时的规则", included: true }],
      cwd: workspace,
    });
  });

  it("reports archive overwrites from the previous stored state", async () => {
    const server = await createTestServer();
    const request = () =>
      server.app.request("http://localhost/v1/archive/archive-test", {
        method: "PUT",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Archive" }),
      });

    const first = await request();
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { id: "archive-test", overwritten: false });

    const second = await request();
    assert.equal(second.status, 200);
    assert.deepEqual(await second.json(), { id: "archive-test", overwritten: true });
  });

  it("accepts authenticated archive uploads into the server data directory", async () => {
    const server = await createTestServer();
    const form = new FormData();
    form.set("source", "codex");
    form.set("file", new File(["{}\n"], "rollout.jsonl", { type: "application/jsonl" }));
    const response = await server.app.request("http://localhost/v1/archive/upload", {
      method: "POST",
      headers: auth(),
      body: form,
    });
    assert.equal(response.status, 201);
    const uploaded = (await response.json()) as { sourcePath: string; size: number };
    assert.equal(uploaded.size, 3);
    assert.equal(uploaded.sourcePath.startsWith(server.config.dataDir), true);
  });

  it("preserves persisted message metadata when a stale client save omits it", async () => {
    const server = await createTestServer();
    await server.store.save({
      schemaVersion: 2,
      id: "metadata-session",
      title: "Metadata",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
        {
          id: "assistant-1",
          role: "assistant",
          parts: [{ type: "text", text: "hi" }],
          metadata: { usage: { inputTokens: 120 } },
        },
      ],
      attachments: [],
    });

    const response = await server.app.request("http://localhost/v1/sessions/metadata-session", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ id: "user-1", role: "user", parts: [{ type: "text", text: "hello again" }] }],
      }),
    });

    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.equal(saved.messages.length, 2);
    assert.deepEqual(saved.messages[1].metadata, { usage: { inputTokens: 120 } });
  });

  it("replaces an empty-id assistant when a stale client sends the same reply with a stable id", async () => {
    const server = await createTestServer();
    const baseMessage = {
      role: "assistant",
      parts: [{ type: "text", text: "same reply" }],
      metadata: { usage: { totalTokens: 3 } },
    };
    await server.store.save({
      schemaVersion: 2,
      id: "duplicate-session",
      title: "Duplicate",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
        { id: "", ...baseMessage } as ChatSession["messages"][number],
      ],
      attachments: [],
    });

    const response = await server.app.request("http://localhost/v1/sessions/duplicate-session", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
          { id: "stable-assistant", ...baseMessage },
        ],
      }),
    });

    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.deepEqual(
      saved.messages.map((message: { id: string }) => message.id),
      ["user-1", "stable-assistant"],
    );
  });

  it("merges stable assistant ids when execution metadata proves they are the same run", async () => {
    const server = await createTestServer();
    const baseMessage = {
      role: "assistant",
      metadata: { usage: { totalTokens: 3 } },
      parts: [
        {
          type: "text",
          text: "same reply",
          providerMetadata: { openai: { itemId: "provider-item-1" } },
        },
      ],
    };
    await server.store.save({
      schemaVersion: 2,
      id: "stable-duplicate-session",
      title: "Duplicate",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [
        { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
        { id: "server-assistant", ...baseMessage } as ChatSession["messages"][number],
      ],
      attachments: [],
    });

    const response = await server.app.request(
      "http://localhost/v1/sessions/stable-duplicate-session",
      {
        method: "PATCH",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { id: "user-1", role: "user", parts: [{ type: "text", text: "hello" }] },
            { id: "server-assistant", ...baseMessage },
            { id: "client-assistant", ...baseMessage },
          ],
        }),
      },
    );

    assert.equal(response.status, 200);
    const saved = await response.json();
    assert.deepEqual(
      saved.messages.map((message: { id: string }) => message.id),
      ["user-1", "server-assistant"],
    );
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

  it("does not import legacy sessions during server startup", async () => {
    const legacyDir = await mkdtemp(path.join(os.tmpdir(), "chatdesk-legacy-chat-"));
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
    const server = await createTestServer();
    assert.equal(await server.store.get("legacy-session"), null);
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
      body: JSON.stringify({
        schemaVersion: 1,
        enabled: true,
        items: [{ id: "m1", content: "事实" }],
      }),
    });
    assert.equal(memory.status, 200);

    await server.app.request("http://localhost/v1/sessions", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "attachment-session" }),
    });
    const attachment = await server.app.request(
      "http://localhost/v1/sessions/attachment-session/attachments",
      {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "file-1",
          fileName: "note.txt",
          base64: Buffer.from("hello").toString("base64"),
        }),
      },
    );
    assert.equal(attachment.status, 201);
    const downloaded = await server.app.request(
      "http://localhost/v1/sessions/attachment-session/attachments/file-1",
      { headers: auth() },
    );
    assert.equal(await downloaded.text(), "hello");
  });

  it("manages local workspaces and activity logs through the server", async () => {
    const server = await createTestServer();
    const workspace = await server.app.request("http://localhost/v1/workspaces", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ path: server.config.dataDir, name: "测试工作区" }),
    });
    assert.equal(workspace.status, 201);
    const project = (await workspace.json()) as { id: string; name: string };
    assert.equal(project.name, "测试工作区");

    const file = await server.app.request(`http://localhost/v1/workspaces/${project.id}/file`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "write", path: "workspace-test.txt", content: "hello" }),
    });
    assert.equal(file.status, 200);
    const read = await server.app.request(`http://localhost/v1/workspaces/${project.id}/file`, {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read", path: "workspace-test.txt" }),
    });
    assert.equal((await read.json()).content, "hello");

    const files = await server.app.request(
      `http://localhost/v1/workspaces/${project.id}/files?path=.`,
      { headers: auth() },
    );
    assert.equal(files.status, 200);
    const listing = (await files.json()) as {
      entries: Array<{ path: string; kind: string }>;
    };
    assert.equal(
      listing.entries.some((entry) => entry.path === "workspace-test.txt" && entry.kind === "file"),
      true,
    );

    const activity = await server.app.request("http://localhost/v1/activity-logs", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ level: "info", source: "test", message: "ok" }),
    });
    assert.equal(activity.status, 201);
    const logs = await server.app.request("http://localhost/v1/activity-logs", { headers: auth() });
    assert.equal((await logs.json()).length, 3);
  });

  it("persists automation tasks and executes them on demand", async () => {
    const server = await createTestServer();
    const task = {
      id: "automation-test",
      name: "测试任务",
      type: "log-current-time",
      intervalMinutes: 5,
      enabled: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const saved = await server.app.request("http://localhost/v1/automations", {
      method: "PUT",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify([task]),
    });
    assert.equal(saved.status, 200);
    const run = await server.app.request("http://localhost/v1/automations/automation-test/run", {
      method: "POST",
      headers: auth(),
    });
    assert.equal(run.status, 204);
    const logs = await server.app.request("http://localhost/v1/activity-logs", { headers: auth() });
    assert.equal((await logs.json()).length, 2);
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

  it("validates model test input before contacting the provider", async () => {
    const server = await createTestServer();
    const response = await server.app.request("http://localhost/v1/models/test", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: "test-model", baseUrl: "ftp://example.com", apiKey: "key" }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /http|https/);
  });

  it("recovers interrupted runs as errored sessions", async () => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), "chatdesk-recovery-"));
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
