import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { RunJournal, SessionStore } from "@chatdesk/agent-core";
import type { ChatRunSummary, ChatSession } from "@chatdesk/shared";
import { afterEach, describe, it, vi } from "vitest";
import { createChatServer } from "./app.ts";
import type { ServerConfig } from "./config.ts";

const { generateTextMock } = vi.hoisted(() => ({
  generateTextMock: vi.fn(),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: generateTextMock,
  };
});

const temporaryDirectories: string[] = [];

afterEach(async () => {
  generateTextMock.mockReset();
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

    const electronPreflight = await server.app.request("http://localhost/v1/sessions", {
      method: "OPTIONS",
      headers: {
        Origin: "chatdesk://localhost",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
    assert.equal(electronPreflight.status, 204);
    assert.equal(
      electronPreflight.headers.get("Access-Control-Allow-Origin"),
      "chatdesk://localhost",
    );
    assert.match(
      electronPreflight.headers.get("Access-Control-Allow-Headers") ?? "",
      /authorization/i,
    );

    const privateNetwork = await server.app.request("http://localhost/v1/sessions", {
      method: "OPTIONS",
      headers: {
        Origin: "http://localhost:1420",
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
        "Access-Control-Request-Private-Network": "true",
      },
    });
    assert.equal(privateNetwork.status, 204);
    assert.equal(
      privateNetwork.headers.get("Access-Control-Allow-Origin"),
      "http://localhost:1420",
    );
    assert.equal(privateNetwork.headers.get("Access-Control-Allow-Private-Network"), "true");

    const fileOrigin = await server.app.request("http://localhost/v1/sessions", {
      headers: { Origin: "null", ...auth() },
    });
    assert.equal(fileOrigin.status, 200);
    assert.equal(fileOrigin.headers.get("Access-Control-Allow-Origin"), "null");

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

  it("filters and limits session list requests", async () => {
    const server = await createTestServer();
    for (const [id, title] of [
      ["search-one", "搜索设计稿"],
      ["search-two", "搜索发布计划"],
      ["search-three", "其他会话"],
    ]) {
      const response = await server.app.request("http://localhost/v1/sessions", {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ id, title }),
      });
      assert.equal(response.status, 201);
    }

    const response = await server.app.request(
      "http://localhost/v1/sessions?query=%E6%90%9C%E7%B4%A2&limit=1",
      { headers: auth() },
    );
    assert.equal(response.status, 200);
    const sessions = (await response.json()) as Array<{
      title: string;
      searchRelevance?: number;
    }>;
    assert.equal(sessions.length, 1);
    assert.match(sessions[0]?.title ?? "", /搜索/);
    assert.equal(typeof sessions[0]?.searchRelevance, "number");
  });

  it("binds new sessions without a workspace to a unique default task directory", async () => {
    const server = await createTestServer();
    const first = await server.app.request("http://localhost/v1/sessions", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "task-one" }),
    });
    const second = await server.app.request("http://localhost/v1/sessions", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "task-two" }),
    });
    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    const left = (await first.json()) as { workspaceId?: string; cwd?: string };
    const right = (await second.json()) as { workspaceId?: string; cwd?: string };
    assert.equal(left.workspaceId, "default");
    assert.equal(right.workspaceId, "default");
    assert.equal(left.cwd?.endsWith("/task-one"), true);
    assert.equal(right.cwd?.endsWith("/task-two"), true);
    assert.notEqual(left.cwd, right.cwd);

    const note = await server.app.request("http://localhost/v1/workspaces/default/file", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "write",
        path: "note.txt",
        content: "hello",
        cwd: left.cwd,
      }),
    });
    assert.equal(note.status, 200);
    const files = await server.app.request(
      `http://localhost/v1/workspaces/default/files?path=.&cwd=${encodeURIComponent(left.cwd ?? "")}`,
      { headers: auth() },
    );
    assert.equal(files.status, 200);
    const listing = (await files.json()) as { entries: Array<{ path: string }> };
    assert.equal(
      listing.entries.some((entry) => entry.path === "note.txt"),
      true,
    );
    assert.equal(
      listing.entries.some((entry) => entry.path === "task-two"),
      false,
    );
    const denied = await server.app.request(
      "http://localhost/v1/workspaces/default/files?path=.&cwd=/tmp",
      { headers: auth() },
    );
    assert.equal(denied.status, 400);

    const removed = await server.app.request("http://localhost/v1/workspaces/default", {
      method: "DELETE",
      headers: auth(),
    });
    assert.equal(removed.status, 400);
  });

  it("rejects session title generation without messages or a configured model", async () => {
    const server = await createTestServer();
    const missing = await server.app.request("http://localhost/v1/sessions/missing/title", {
      method: "POST",
      headers: auth(),
    });
    assert.equal(missing.status, 404);

    const created = await server.app.request("http://localhost/v1/sessions", {
      method: "POST",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({ id: "title-session" }),
    });
    assert.equal(created.status, 201);
    const empty = await server.app.request("http://localhost/v1/sessions/title-session/title", {
      method: "POST",
      headers: auth(),
    });
    assert.equal(empty.status, 400);
    assert.match((await empty.json()).error, /还没有内容/);

    const session = await server.store.get("title-session");
    assert.ok(session);
    await server.store.save({
      ...session,
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "帮我检查构建" }],
        },
      ],
    });
    const unconfigured = await server.app.request(
      "http://localhost/v1/sessions/title-session/title",
      { method: "POST", headers: auth() },
    );
    assert.equal(unconfigured.status, 400);
    assert.match((await unconfigured.json()).error, /未配置可用模型/);
  });

  it("does not change session recency when regenerating a title", async () => {
    generateTextMock.mockResolvedValue({ text: "检查构建" });
    const server = await createTestServer();
    const configured = await server.app.request("http://localhost/v1/chat-config", {
      method: "PATCH",
      headers: { ...auth(), "Content-Type": "application/json" },
      body: JSON.stringify({
        models: [
          {
            id: "title-model",
            name: "title-model",
            baseUrl: "https://example.com/v1",
            apiKey: "test-key",
          },
        ],
      }),
    });
    assert.equal(configured.status, 200);

    await server.store.save({
      schemaVersion: 2,
      id: "older-session",
      title: "旧标题",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      messages: [
        {
          id: "user-1",
          role: "user",
          parts: [{ type: "text", text: "帮我检查构建" }],
        },
      ],
      attachments: [],
    });
    await server.store.save({
      schemaVersion: 2,
      id: "newer-session",
      title: "较新对话",
      createdAt: "2026-01-02T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
      messages: [],
      attachments: [],
    });

    const generated = await server.app.request("http://localhost/v1/sessions/older-session/title", {
      method: "POST",
      headers: auth(),
    });
    assert.equal(generated.status, 200);
    assert.equal((await generated.json()).title, "检查构建");

    const older = await server.store.get("older-session");
    assert.equal(older?.title, "检查构建");
    assert.equal(older?.updatedAt, "2026-01-01T00:00:00.000Z");

    const list = await server.app.request("http://localhost/v1/sessions", { headers: auth() });
    assert.deepEqual(
      ((await list.json()) as Array<{ id: string }>).map((session) => session.id),
      ["newer-session", "older-session"],
    );
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
        disabledSkillIds: ["agents:demo"],
        sandboxMode: "auto",
        sandboxReadablePaths: ["/"],
        developerToolPaths: ["relative/bin", "/usr/bin", "/usr/bin", "/"],
      }),
    });
    assert.equal(config.status, 200);
    assert.deepEqual((await config.json()).apiKeys, { dataer: "secret" });

    const loadedConfig = await server.app.request("http://localhost/v1/chat-config", {
      headers: auth(),
    });
    const loadedConfigData = await loadedConfig.json();
    assert.equal(loadedConfigData.sandboxMode, "auto");
    assert.deepEqual(loadedConfigData.sandboxReadablePaths, ["/"]);
    assert.deepEqual(loadedConfigData.developerToolPaths, ["/usr/bin"]);
    assert.deepEqual(loadedConfigData.disabledSkillIds, ["agents:demo"]);

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
    const saved = (await attachment.json()) as { size: number; fileName: string };
    assert.equal(saved.fileName, "note.txt");
    assert.equal(saved.size, 5);
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

    const suggestions = await server.app.request(
      `http://localhost/v1/workspaces/${project.id}/path-suggestions`,
      {
        method: "POST",
        headers: { ...auth(), "Content-Type": "application/json" },
        body: JSON.stringify({ query: "workspace-" }),
      },
    );
    assert.equal(suggestions.status, 200);
    assert.deepEqual(await suggestions.json(), {
      suggestions: [{ path: "workspace-test.txt", kind: "file" }],
      truncated: false,
    });

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
      messages: [
        {
          id: "assistant-recovered",
          role: "assistant",
          parts: [
            {
              type: "tool-read_file",
              toolCallId: "tool-recovered",
              state: "input-available",
              input: { path: "README.md" },
            },
          ],
        },
      ],
      attachments: [],
    });
    const journal = new RunJournal(dataDir);
    await journal.begin({
      sessionId: "recovered-session",
      runId: "run-recovered",
      startedAt: "2026-01-01T00:00:00.000Z",
      messageId: "assistant-recovered",
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
    const sessionList = await sessions.json();
    assert.equal(sessionList[0]?.status, "error");
    const recovered = await server.store.get("recovered-session");
    const recoveredTool = recovered?.messages[0]?.parts[0];
    assert.equal(
      recoveredTool && "state" in recoveredTool ? recoveredTool.state : undefined,
      "output-error",
    );
    assert.equal(
      recoveredTool && "errorText" in recoveredTool ? recoveredTool.errorText : undefined,
      "Chat Server 重启，运行已中断",
    );
    const recoveredSummary = (
      recovered?.messages[0]?.metadata as { runSummary?: ChatRunSummary } | undefined
    )?.runSummary;
    assert.ok(recoveredSummary);
    const {
      durationMs: recoveredDurationMs,
      startedAt: recoveredStartedAt,
      ...recoveredSummaryRest
    } = recoveredSummary;
    assert.deepEqual(recoveredSummaryRest, {
      runId: "run-recovered",
      outcome: "error",
      stopReason: "server-restarted",
      stepCount: 0,
      modelCallCount: 0,
      toolCallCount: 0,
      duplicateToolCallCount: 0,
      compactionCount: 0,
      planWritten: false,
    });
    assert.equal(typeof recoveredDurationMs, "number");
    assert.equal(recoveredStartedAt, "2026-01-01T00:00:00.000Z");
    const {
      durationMs: lastRunDurationMs,
      startedAt: lastRunStartedAt,
      ...lastRunSummaryRest
    } = sessionList[0]?.lastRunSummary ?? {};
    assert.deepEqual(lastRunSummaryRest, {
      runId: "run-recovered",
      outcome: "error",
      stopReason: "server-restarted",
      stepCount: 0,
      modelCallCount: 0,
      toolCallCount: 0,
      duplicateToolCallCount: 0,
      compactionCount: 0,
      planWritten: false,
    });
    assert.equal(typeof lastRunDurationMs, "number");
    assert.equal(lastRunStartedAt, "2026-01-01T00:00:00.000Z");
    assert.deepEqual(await journal.recover(), []);
  });
});
