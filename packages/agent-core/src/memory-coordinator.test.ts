import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ChatSession } from "@chatdesk/shared";
import { MockLanguageModelV4 } from "ai/test";
import { afterEach, describe, it } from "vitest";
import { ActivityLogStore } from "./activity-log-store.ts";
import { AiUsageLogStore } from "./ai-usage-log.ts";
import { ChatConfigStore } from "./chat-config.ts";
import {
  MemoryCoordinator,
  memorySessionEligibility,
  redactMemorySecrets,
} from "./memory-coordinator.ts";
import { MemoryStore } from "./memory-store.ts";
import { SessionStore } from "./store.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function session(toolName?: string, userText = "请分析项目约束"): ChatSession {
  return {
    schemaVersion: 2,
    id: "session-a",
    title: "测试",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    messages: [
      { id: "user", role: "user", parts: [{ type: "text", text: userText }] },
      {
        id: "assistant",
        role: "assistant",
        parts: [
          ...(toolName
            ? ([
                {
                  type: `tool-${toolName}`,
                  toolCallId: "call",
                  state: "output-available",
                  input: {},
                  output: {},
                },
              ] as never[])
            : []),
          { type: "text", text: "项目固定使用 pnpm。" },
        ],
      },
    ],
    attachments: [],
  };
}

function assertAllObjectPropertiesRequired(schema: unknown): void {
  if (!schema || typeof schema !== "object") return;
  const record = schema as Record<string, unknown>;
  if (record.type === "object" && record.properties && typeof record.properties === "object") {
    const propertyNames = Object.keys(record.properties as Record<string, unknown>).sort();
    const required = Array.isArray(record.required) ? [...record.required].sort() : [];
    assert.deepEqual(required, propertyNames);
  }
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) value.forEach(assertAllObjectPropertiesRequired);
    else assertAllObjectPropertiesRequired(value);
  }
}

describe("memory eligibility and redaction", () => {
  it("allows local workspace tools and skips external tools", () => {
    assert.equal(memorySessionEligibility(session("read_file")).eligible, true);
    assert.equal(memorySessionEligibility(session("web_search")).eligible, false);
  });

  it("lets explicit memory intent override external context exclusion", () => {
    assert.equal(
      memorySessionEligibility(session("web_search", "请记住我偏好中文")).eligible,
      true,
    );
  });

  it("redacts credentials before persistence", () => {
    const result = redactMemorySecrets(
      "Authorization: Bearer secret-token api_key=sk-abcdefghijklmnop",
    );
    assert.equal(result.includes("secret-token"), false);
    assert.equal(result.includes("sk-abcdefghijklmnop"), false);
  });

  it("runs extraction and consolidation and persists usage for both model calls", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "chatdesk-memory-pipeline-"));
    directories.push(directory);
    const sessions = new SessionStore(directory);
    await sessions.init();
    const sourceSession = { ...session(), workspaceId: "workspace-a" };
    await sessions.save(sourceSession);
    const memory = new MemoryStore(directory);
    await memory.init();
    const config = new ChatConfigStore(directory);
    await config.init();
    await config.update({
      models: [
        {
          id: "mock",
          name: "mock-model",
          provider: "test",
          baseUrl: "http://mock.invalid/v1",
          isDefault: true,
        },
      ],
      apiKeys: { mock: "test-key" },
    });
    const usageLogs = new AiUsageLogStore(directory);
    await usageLogs.init();
    const activityLogs = new ActivityLogStore(directory);
    await activityLogs.init();
    let calls = 0;
    const languageModel = new MockLanguageModelV4({
      doGenerate: async (options) => {
        assert.equal(options.responseFormat?.type, "json");
        assertAllObjectPropertiesRequired(options.responseFormat?.schema);
        calls += 1;
        const output =
          calls === 1
            ? {
                facts: [
                  {
                    content: "项目固定使用 pnpm",
                    scope: "workspace",
                    category: "project",
                    keywords: ["pnpm"],
                    evidence: [{ messageId: "assistant", excerpt: "项目固定使用 pnpm。" }],
                  },
                ],
                summary: "项目依赖管理约束",
              }
            : {
                facts: [
                  {
                    content: "项目固定使用 pnpm",
                    scope: "workspace",
                    workspaceId: "workspace-a",
                    category: "project",
                    keywords: ["pnpm"],
                    sourceSessionIds: ["session-a"],
                  },
                ],
                summaries: [
                  {
                    scope: "workspace",
                    workspaceId: "workspace-a",
                    content: "该项目固定使用 pnpm。",
                    keywords: ["pnpm"],
                  },
                ],
              };
        return {
          content: [{ type: "text", text: JSON.stringify(output) }],
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 5, text: 5, reasoning: 0 },
          },
          warnings: [],
          response: { id: `response-${calls}`, modelId: "mock-provider-model" },
        };
      },
    });
    const coordinator = new MemoryCoordinator(
      memory,
      sessions,
      config,
      usageLogs,
      activityLogs,
      () => languageModel,
    );
    await memory.saveJob({
      id: "failed-extraction",
      kind: "extract",
      sessionId: sourceSession.id,
      workspaceId: sourceSession.workspaceId,
      status: "failed",
      attempts: 3,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:01:00.000Z",
      error: "Required properties must match all properties in the object",
    });
    coordinator.initialize();
    assert.deepEqual(await coordinator.enqueueBackfill(), { queued: 1 });
    for (
      let index = 0;
      index < 100 && memory.get().pipeline.runningJobs + memory.get().pipeline.queuedJobs > 0;
      index += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await coordinator.shutdown();

    assert.equal(memory.listJobs().find((job) => job.id === "failed-extraction")?.attempts, 1);
    assert.equal(memory.get().items[0]?.content, "项目固定使用 pnpm");
    assert.equal(memory.get().items[0]?.workspaceId, "workspace-a");
    assert.equal(memory.listSources()[0]?.facts[0]?.evidence[0]?.messageId, "assistant");
    assert.deepEqual(
      usageLogs
        .list()
        .map((entry) => entry.operation)
        .sort(),
      ["memory.consolidate", "memory.extract"],
    );
    assert.equal(
      usageLogs.list().every((entry) => entry.jobId),
      true,
    );
  });
});
