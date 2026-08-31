import type { ChatSession, CreateTaskOutput, RunStartInput, SessionStatus } from "@chatdesk/shared";
import {
  CREATE_TASK_RESULT_MAX_CHARS,
  CREATE_TASK_TOOL_NAME,
  DEFAULT_WORKSPACE_ID,
} from "@chatdesk/shared";
import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import type { EventHub } from "./events.ts";
import { type CreateTaskRunner, createTaskTool } from "./task-tool.ts";

type StoredSession = ChatSession;

function createMemoryStore() {
  const sessions = new Map<string, StoredSession>();
  return {
    sessions,
    async get(id: string) {
      return sessions.get(id) ?? null;
    },
    async save(session: ChatSession) {
      sessions.set(session.id, session);
    },
  };
}

function createEventHub(): EventHub {
  return {
    subscribe() {
      return {
        next: (timeoutMs = 0) =>
          new Promise((resolve) => {
            setTimeout(() => resolve(null), Math.min(timeoutMs || 10, 20));
          }),
        close() {},
      };
    },
  } as EventHub;
}

function createMockRunner(store: ReturnType<typeof createMemoryStore>): CreateTaskRunner & {
  active: Set<string>;
  inputs: Map<string, RunStartInput>;
  spawned: Map<string, Set<string>>;
  finish(sessionId: string, preview: string, parts?: UIMessage["parts"]): Promise<void>;
} {
  const active = new Set<string>();
  const inputs = new Map<string, RunStartInput>();
  const waiters = new Map<string, () => void>();
  const spawned = new Map<string, Set<string>>();
  return {
    active,
    inputs,
    spawned,
    async startDetached(sessionId: string, input: RunStartInput) {
      active.add(sessionId);
      inputs.set(sessionId, input);
      return sessionId;
    },
    isActive(sessionId: string) {
      return active.has(sessionId);
    },
    statusOf(sessionId: string): SessionStatus {
      return active.has(sessionId) ? "streaming" : "ready";
    },
    waitForRun(sessionId: string) {
      if (!active.has(sessionId)) return Promise.resolve();
      return new Promise<void>((resolve) => {
        waiters.set(sessionId, resolve);
      });
    },
    async stop(sessionId: string) {
      if (!active.has(sessionId)) return false;
      active.delete(sessionId);
      waiters.get(sessionId)?.();
      waiters.delete(sessionId);
      return true;
    },
    trackSpawnedTask(parentSessionId: string, childSessionId: string) {
      const children = spawned.get(parentSessionId) ?? new Set<string>();
      children.add(childSessionId);
      spawned.set(parentSessionId, children);
    },
    async finish(sessionId: string, preview: string, parts?: UIMessage["parts"]) {
      const session = await store.get(sessionId);
      if (session) {
        await store.save({
          ...session,
          messages: [
            ...session.messages,
            {
              id: "assistant-1",
              role: "assistant",
              parts: parts ?? [{ type: "text", text: preview }],
              metadata: {
                runSummary: {
                  runId: "run-1",
                  outcome: "completed",
                  stepCount: 1,
                  modelCallCount: 1,
                  toolCallCount: 0,
                  duplicateToolCallCount: 0,
                  compactionCount: 0,
                  planWritten: false,
                },
              },
            },
          ],
        });
      }
      active.delete(sessionId);
      waiters.get(sessionId)?.();
      waiters.delete(sessionId);
    },
  };
}

async function waitForChild(store: ReturnType<typeof createMemoryStore>) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const childId = [...store.sessions.keys()][0];
    if (childId) return childId;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("task session was not created");
}

async function collectExecute(
  execute: unknown,
  input: { prompt: string; title?: string; agentId?: string; workspaceId?: string },
) {
  if (typeof execute !== "function") throw new Error("create_task 缺少 execute");
  const result = execute(input, {
    toolCallId: "call-1",
    messages: [],
    abortSignal: new AbortController().signal,
  });
  const snapshots: CreateTaskOutput[] = [];
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    for await (const snapshot of result as AsyncIterable<CreateTaskOutput>) {
      snapshots.push(snapshot);
    }
    return snapshots;
  }
  snapshots.push(await result);
  return snapshots;
}

describe("create_task tool", () => {
  it("creates a non-interactive session and reports completion", async () => {
    const store = createMemoryStore();
    const runner = createMockRunner(store);
    const tool = createTaskTool({
      store: store as never,
      events: createEventHub(),
      runner,
      parentSessionId: "parent-1",
      parentInput: { toolNames: [CREATE_TASK_TOOL_NAME, "read_file"] } as RunStartInput,
    });
    const ordinaryShape = (tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(ordinaryShape).not.toHaveProperty("agentId");
    expect(ordinaryShape).not.toHaveProperty("workspaceId");

    const pending = collectExecute(tool.execute, {
      prompt: "列出 src 目录结构",
      title: "调研目录",
    });
    const childId = await waitForChild(store);
    await runner.finish(childId, "src 下有 3 个文件");
    const snapshots = await pending;
    const last = snapshots[snapshots.length - 1];
    expect(last?.status).toBe("completed");
    expect(last?.title).toBe("调研目录");
    expect(last?.preview).toContain("3 个文件");
    expect(last?.result).toBeUndefined();
    const session = store.sessions.get(childId);
    expect(session?.kind).toBe("task");
    expect(session?.parentSessionId).toBe("parent-1");
  });

  it("streams an in-progress snapshot before completion", async () => {
    const store = createMemoryStore();
    const runner = createMockRunner(store);
    const tool = createTaskTool({
      store: store as never,
      events: createEventHub(),
      runner,
      parentSessionId: "parent-1",
      parentInput: {} as RunStartInput,
    });

    const pending = collectExecute(tool.execute, { prompt: "并行调研 A" });
    const childId = await waitForChild(store);
    expect(runner.isActive(childId)).toBe(true);
    await runner.finish(childId, "A 完成");
    const snapshots = await pending;
    expect(snapshots.some((snapshot) => snapshot.status === "running")).toBe(true);
    expect(snapshots.at(-1)?.status).toBe("completed");
  });

  it("can keep two tasks active at the same time", async () => {
    const store = createMemoryStore();
    const runner = createMockRunner(store);
    const context = {
      store: store as never,
      events: createEventHub(),
      runner,
      parentSessionId: "parent-1",
      parentInput: {} as RunStartInput,
    };
    const first = collectExecute(createTaskTool(context).execute, { prompt: "任务一" });
    const second = collectExecute(createTaskTool(context).execute, { prompt: "任务二" });
    await waitForChild(store);
    for (let attempt = 0; attempt < 50 && runner.active.size < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(runner.active.size).toBe(2);
    const [firstId, secondId] = [...store.sessions.keys()];
    await runner.finish(firstId, "一完成");
    await runner.finish(secondId, "二完成");
    const [firstSnapshots, secondSnapshots] = await Promise.all([first, second]);
    expect(firstSnapshots.at(-1)?.status).toBe("completed");
    expect(secondSnapshots.at(-1)?.status).toBe("completed");
  });

  it("reports headings and a tool glance instead of only the markdown body", async () => {
    const store = createMemoryStore();
    const runner = createMockRunner(store);
    const tool = createTaskTool({
      store: store as never,
      events: createEventHub(),
      runner,
      parentSessionId: "parent-1",
      parentInput: {} as RunStartInput,
    });

    const pending = collectExecute(tool.execute, { prompt: "调研接口", title: "接口调研" });
    const childId = await waitForChild(store);
    await runner.finish(childId, "markdown body", [
      {
        type: "tool-read_file",
        toolCallId: "read-1",
        state: "output-available",
        input: { path: "src/app.ts" },
        output: { content: "ok" },
      },
      {
        type: "text",
        text: "## 结论\n子任务写了一大段 markdown，不应整段出现在父对话。\n## 建议\n只保留标题和工具。",
      },
    ]);
    const last = (await pending).at(-1);
    expect(last?.preview).toContain("一大段 markdown");
    expect(last?.headings).toEqual(["结论", "建议"]);
    expect(last?.tools).toEqual([{ name: "read_file", detail: "app.ts" }]);
  });

  it("applies a targeted Agent and Workspace without inheriting the parent cwd", async () => {
    const store = createMemoryStore();
    const runner = createMockRunner(store);
    const tool = createTaskTool({
      store: store as never,
      events: createEventHub(),
      runner,
      parentSessionId: "parent-1",
      parentInput: {
        modelId: "parent-model",
        workspaceId: "parent-workspace",
        cwd: "/work/parent",
      },
      targeting: {
        description: "可选择 Agent 和 Workspace。",
        resolve: ({ agentId, workspaceId }) => ({
          agentId: agentId || "main-agent",
          runInput: {
            agentId: agentId || "main-agent",
            modelId: agentId ? "review-model" : "main-model",
            system: agentId ? "review system" : "main system",
            toolNames: ["read_file"],
            workspaceId: workspaceId || DEFAULT_WORKSPACE_ID,
            cwd: undefined,
          },
        }),
      },
    });
    const targetedShape = (tool.inputSchema as unknown as { shape: Record<string, unknown> }).shape;
    expect(targetedShape).toHaveProperty("agentId");
    expect(targetedShape).toHaveProperty("workspaceId");

    const pending = collectExecute(tool.execute, {
      prompt: "审查项目",
      agentId: "reviewer",
      workspaceId: "project",
    });
    const childId = await waitForChild(store);
    await runner.finish(childId, "审查完成");
    await pending;

    expect(store.sessions.get(childId)).toMatchObject({
      agentId: "reviewer",
      modelId: "review-model",
      workspaceId: "project",
    });
    expect(store.sessions.get(childId)?.cwd).toBeUndefined();
    expect(runner.inputs.get(childId)).toMatchObject({
      agentId: "reviewer",
      modelId: "review-model",
      workspaceId: "project",
      toolNames: ["read_file"],
    });
    expect(runner.inputs.get(childId)?.cwd).toBeUndefined();
  });

  it("returns a bounded final result only when requested", async () => {
    const store = createMemoryStore();
    const runner = createMockRunner(store);
    const tool = createTaskTool({
      store: store as never,
      events: createEventHub(),
      runner,
      parentSessionId: "parent-1",
      parentInput: {},
      resultMaxChars: CREATE_TASK_RESULT_MAX_CHARS,
    });

    const pending = collectExecute(tool.execute, { prompt: "生成长结果" });
    const childId = await waitForChild(store);
    await runner.finish(childId, "x".repeat(CREATE_TASK_RESULT_MAX_CHARS + 1_000));
    const result = (await pending).at(-1)?.result;

    expect(result).toHaveLength(CREATE_TASK_RESULT_MAX_CHARS);
    expect(result).toMatch(/\[结果已截断\]$/);
  });

  it("rejects a stale target before creating a task session", async () => {
    const store = createMemoryStore();
    const runner = createMockRunner(store);
    const tool = createTaskTool({
      store: store as never,
      events: createEventHub(),
      runner,
      parentSessionId: "parent-1",
      parentInput: {},
      targeting: {
        description: "可选择 Agent。",
        resolve: () => {
          throw new Error("任务 Agent 不存在或已失效：removed");
        },
      },
    });

    await expect(
      collectExecute(tool.execute, { prompt: "执行任务", agentId: "removed" }),
    ).rejects.toThrow("任务 Agent 不存在或已失效：removed");
    expect(store.sessions.size).toBe(0);
  });
});
