import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MemoryItem, MemorySource } from "@chatdesk/shared";
import { afterEach, describe, it } from "vitest";
import { MemoryStore } from "./memory-store.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chatdesk-memory-"));
  directories.push(directory);
  const store = new MemoryStore(directory);
  await store.init();
  return { directory, store };
}

function generatedItem(values: Partial<MemoryItem> = {}): MemoryItem {
  return {
    id: values.id ?? "generated-1",
    content: values.content ?? "项目使用 pnpm 管理依赖",
    scope: values.scope ?? "workspace",
    workspaceId: values.workspaceId ?? "workspace-a",
    category: values.category ?? "project",
    status: values.status ?? "active",
    pinned: values.pinned ?? false,
    source: "generated",
    keywords: values.keywords ?? ["pnpm", "依赖"],
    evidence: values.evidence ?? [
      {
        sessionId: "session-a",
        messageId: "message-a",
        excerpt: "这个项目固定使用 pnpm。",
        capturedAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    createdAt: values.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: values.updatedAt ?? "2026-01-01T00:00:00.000Z",
    usageCount: values.usageCount ?? 0,
    ...(values.lastUsedAt ? { lastUsedAt: values.lastUsedAt } : {}),
  };
}

describe("MemoryStore", () => {
  it("loads legacy flat items as pinned global memories without rewriting on init", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chatdesk-memory-legacy-"));
    directories.push(directory);
    const file = path.join(directory, "memory.json");
    const legacy = {
      schemaVersion: 1,
      enabled: false,
      items: [
        {
          id: "legacy",
          content: "用户偏好中文",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    };
    await writeFile(file, JSON.stringify(legacy), "utf8");
    const store = new MemoryStore(directory);
    await store.init();

    const overview = store.get();
    assert.equal(overview.settings.useMemories, false);
    assert.deepEqual(
      overview.items.map((item) => ({
        scope: item.scope,
        source: item.source,
        pinned: item.pinned,
      })),
      [{ scope: "global", source: "manual", pinned: true }],
    );
    assert.equal(await readFile(file, "utf8"), JSON.stringify(legacy));
  });

  it("isolates workspace memories and records retrieval usage", async () => {
    const { store } = await createStore();
    await store.replaceGenerated(
      [
        generatedItem(),
        generatedItem({ id: "workspace-b", workspaceId: "workspace-b", content: "项目使用 npm" }),
        generatedItem({
          id: "global",
          scope: "global",
          workspaceId: undefined,
          content: "用户偏好简洁中文",
          category: "preference",
        }),
      ],
      [],
    );

    const results = await store.search("项目 pnpm 中文", "workspace-a");
    assert.deepEqual(results.map((item) => item.id).sort(), ["generated-1", "global"]);
    assert.equal(store.get().items.find((item) => item.id === "generated-1")?.usageCount, 1);
    assert.equal(store.get().items.find((item) => item.id === "workspace-b")?.usageCount, 0);
  });

  it("archives generated memories after their only source is removed", async () => {
    const { store } = await createStore();
    const source: MemorySource = {
      sessionId: "session-a",
      sessionTitle: "来源会话",
      workspaceId: "workspace-a",
      sourceUpdatedAt: "2026-01-01T00:00:00.000Z",
      generatedAt: "2026-01-01T00:00:00.000Z",
      facts: [],
      summary: "",
    };
    await store.saveSource(source);
    await store.replaceGenerated([generatedItem()], []);
    await store.removeSource("session-a");

    const item = store.get().items[0];
    assert.equal(item?.status, "archived");
    assert.equal(item?.archiveReason, "来源会话已删除");
    assert.deepEqual(item?.evidence, []);
  });

  it("archives old unused generated memories but preserves manual entries", async () => {
    const { store } = await createStore();
    await store.updateSettings({ maxUnusedDays: 1 });
    await store.replaceGenerated([generatedItem({ updatedAt: "2020-01-01T00:00:00.000Z" })], []);
    await store.createItem({ content: "固定事实" });
    await store.archiveUnused(new Date("2026-08-26T00:00:00.000Z"));

    assert.equal(store.get().items.find((item) => item.source === "generated")?.status, "archived");
    assert.equal(store.get().items.find((item) => item.source === "manual")?.status, "active");
  });
});
