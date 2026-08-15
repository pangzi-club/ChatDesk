import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { afterEach, describe, it } from "vitest";
import { ActivityLogStore } from "./activity-log-store.ts";
import { AiUsageLogStore } from "./ai-usage-log.ts";
import { ChatConfigStore } from "./chat-config.ts";
import { EventHub } from "./events.ts";
import { PlanStore } from "./plan-store.ts";
import type { ChatRunSummary, ChatSession, ServerEvent } from "./protocol.ts";
import { RunRegistry } from "./run-registry.ts";
import { SessionStore } from "./store.ts";

type MockStreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;
type MockStreamPart = MockStreamResult["stream"] extends ReadableStream<infer Part> ? Part : never;
type MockGenerateResult = Awaited<ReturnType<MockLanguageModelV4["doGenerate"]>>;

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function usage() {
  return {
    inputTokens: { total: 10, noCache: 7, cacheRead: 2, cacheWrite: 1 },
    outputTokens: { total: 3, text: 2, reasoning: 1 },
  };
}

function streamResult(
  chunks: MockStreamPart[],
  timing: { initialDelayInMs?: number; chunkDelayInMs?: number } = {},
): MockStreamResult {
  return { stream: simulateReadableStream({ chunks, ...timing }) };
}

function textResult(
  text: string,
  responseId: string,
  finish: "stop" | "length" | "error" = "stop",
): MockStreamResult {
  return streamResult([
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: responseId, modelId: "mock-model" },
    { type: "text-start", id: `${responseId}-text` },
    { type: "text-delta", id: `${responseId}-text`, delta: text },
    { type: "text-end", id: `${responseId}-text` },
    { type: "finish", finishReason: { unified: finish, raw: finish }, usage: usage() },
  ]);
}

function toolResult(
  toolCallId: string,
  toolName: string,
  input: Record<string, unknown>,
): MockStreamResult {
  return streamResult([
    { type: "stream-start", warnings: [] },
    { type: "response-metadata", id: `response-${toolCallId}`, modelId: "mock-model" },
    { type: "tool-call", toolCallId, toolName, input: JSON.stringify(input) },
    {
      type: "finish",
      finishReason: { unified: "tool-calls", raw: "tool-calls" },
      usage: usage(),
    },
  ]);
}

function checkpointResult(text: string): MockGenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: usage(),
    warnings: [],
    response: { id: "checkpoint-response", modelId: "mock-model" },
  };
}

class CapturingEventHub extends EventHub {
  readonly published: Array<Omit<ServerEvent, "id" | "timestamp">> = [];

  override publish(event: Omit<ServerEvent, "id" | "timestamp">) {
    this.published.push(event);
    return super.publish(event);
  }
}

async function fixture(
  results: MockStreamResult[],
  options: {
    inputContext?: number;
    messages?: ChatSession["messages"];
    doGenerate?: MockGenerateResult | MockLanguageModelV4["doGenerate"];
    planMode?: "plan" | "apply";
    planContent?: string;
    modelStreamTimeout?: { firstChunkMs: number; chunkMs: number };
  } = {},
) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chatdesk-run-"));
  directories.push(directory);
  const workspace = path.join(directory, "workspace");
  await writeFile(path.join(directory, ".keep"), "", "utf8");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(workspace));
  await writeFile(path.join(workspace, "source.txt"), "stable content", "utf8");
  const store = new SessionStore(directory);
  await store.init();
  const config = new ChatConfigStore(directory);
  await config.init();
  await config.update({
    sandboxMode: "full",
    models: [
      {
        id: "mock",
        provider: "openai-compatible",
        name: "mock-model",
        baseUrl: "http://mock.invalid/v1",
        apiKey: "test-key",
        supportsTools: true,
        inputContext: options.inputContext ?? 128_000,
      },
    ],
  });
  const plans = new PlanStore(directory);
  const plan = await plans.create("session-1");
  if (options.planContent !== undefined) {
    await plans.write("session-1", plan.id, options.planContent);
  }
  const now = new Date().toISOString();
  const session: ChatSession = {
    schemaVersion: 2,
    id: "session-1",
    title: "Run test",
    createdAt: now,
    updatedAt: now,
    cwd: workspace,
    messages: options.messages ?? [
      { id: "user-1", role: "user", parts: [{ type: "text", text: "make a plan" }] },
    ],
    attachments: [],
    plans: [plan],
    planMode: options.planMode ?? "plan",
    activePlanId: options.planMode === "apply" ? undefined : plan.id,
  };
  await store.save(session);
  const usageLogs = new AiUsageLogStore(directory);
  await usageLogs.init();
  const activityLogs = new ActivityLogStore(directory);
  await activityLogs.init();
  const events = new CapturingEventHub();
  const model = new MockLanguageModelV4({
    provider: "mock-provider",
    modelId: "mock-model",
    doGenerate: options.doGenerate,
    doStream: results,
  });
  const registry = new RunRegistry(
    store,
    events,
    config,
    plans,
    usageLogs,
    activityLogs,
    () => undefined,
    () => model,
    options.modelStreamTimeout,
  );
  await registry.initialize();
  return {
    registry,
    store,
    events,
    usageLogs,
    activityLogs,
    plans,
    plan,
    model,
    planMode: options.planMode ?? "plan",
  };
}

async function finishRun(fixtureValue: Awaited<ReturnType<typeof fixture>>) {
  const response = await fixtureValue.registry.start("session-1", {
    modelId: "mock",
    planMode: fixtureValue.planMode,
    ...(fixtureValue.planMode === "plan" ? { planId: fixtureValue.plan.id } : {}),
    toolNames: ["read_file"],
  });
  await response.text().catch(() => undefined);
  for (let attempt = 0; attempt < 1_000 && fixtureValue.registry.activeCount() > 0; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(fixtureValue.registry.activeCount(), 0);
  const session = await fixtureValue.store.get("session-1");
  assert.ok(session);
  const last = session.messages.at(-1);
  assert.ok(last?.role === "assistant");
  return (last.metadata as { runSummary: ChatRunSummary }).runSummary;
}

describe("complete agent runs", () => {
  it("records model lifecycle and streaming errors without prompt contents", async () => {
    const current = await fixture([
      streamResult([
        { type: "stream-start", warnings: [] },
        { type: "error", error: new TypeError("Load failed") },
      ]),
    ]);
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "error");

    const diagnostics = current.activityLogs
      .list()
      .filter((entry) => entry.source === "Agent Run Diagnostic");
    assert.ok(diagnostics.some((entry) => /模型调用 1 开始/.test(entry.message)));
    const streamError = diagnostics.find((entry) => entry.message === "模型流式响应错误");
    assert.match(streamError?.details ?? "", /Load failed/);
    assert.doesNotMatch(streamError?.details ?? "", /make a plan/);
  });

  it("records client stream cancellation without cancelling the server run", async () => {
    const current = await fixture([
      streamResult(
        [
          { type: "stream-start", warnings: [] },
          {
            type: "response-metadata",
            id: "delayed-response",
            modelId: "mock-model",
          },
          { type: "text-start", id: "delayed-text" },
          { type: "text-delta", id: "delayed-text", delta: "partial" },
          { type: "text-end", id: "delayed-text" },
          { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: usage() },
        ],
        { chunkDelayInMs: 40 },
      ),
    ]);
    const response = await current.registry.start("session-1", {
      modelId: "mock",
      planMode: current.planMode,
      planId: current.plan.id,
      toolNames: ["read_file"],
    });
    const reader = response.body?.getReader();
    assert.ok(reader);
    await reader.read();
    await reader.cancel(new TypeError("Load failed"));

    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (current.activityLogs.list().some((entry) => entry.message === "客户端响应流已取消"))
        break;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const cancellation = current.activityLogs
      .list()
      .find((entry) => entry.message === "客户端响应流已取消");
    assert.match(cancellation?.details ?? "", /Load failed/);
    assert.doesNotMatch(cancellation?.details ?? "", /make a plan/);

    for (let attempt = 0; attempt < 1_000 && current.registry.activeCount() > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    assert.equal(current.registry.activeCount(), 0);
    const session = await current.store.get("session-1");
    const summary = session?.messages.at(-1)?.metadata as { runSummary?: ChatRunSummary };
    assert.equal(summary.runSummary?.outcome, "error");
  });

  it("rejects a plain-text plan question as incomplete", async () => {
    const current = await fixture([textResult("需要确认部署区域。", "response-question")]);
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "error");
    assert.equal(summary.stopReason, "incomplete-response");
    assert.equal(summary.planWritten, false);
    assert.equal(summary.modelCallCount, 1);
    assert.equal(current.usageLogs.list().length, 1);
    assert.equal(current.usageLogs.list()[0]?.runId, summary.runId);
    assert.deepEqual(current.usageLogs.list()[0]?.usage, {
      inputTokens: 10,
      outputTokens: 3,
      totalTokens: 13,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      reasoningOutputTokens: 1,
    });
    assert.ok(current.events.published.some((event) => event.type === "run.progress"));
    assert.ok(current.events.published.some((event) => event.type === "run.error"));
  });

  it("persists a structured plan question without requiring final text", async () => {
    const current = await fixture([
      toolResult("question", "request_user_input", {
        questions: [
          {
            id: "region",
            header: "部署区域",
            question: "请选择部署区域",
            recommendedOptionId: "cn",
            options: [
              { id: "cn", label: "中国大陆" },
              { id: "global", label: "全球" },
            ],
          },
        ],
      }),
    ]);
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "awaiting-user");
    assert.equal(summary.planWritten, false);
    assert.equal(summary.toolCallCount, 1);
    assert.equal(summary.modelCallCount, 1);
    assert.equal(current.usageLogs.list().length, 1);
    const session = await current.store.get("session-1");
    assert.equal(
      session?.messages.at(-1)?.parts.some((part) => part.type.includes("request_user_input")),
      true,
    );
  });

  it("requires non-empty plan_write followed by a text-only final step", async () => {
    const current = await fixture([
      toolResult("plan", "plan_write", { content: "# Plan\n\n1. Implement." }),
      textResult("计划已写入。", "response-final"),
    ]);
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "completed");
    assert.equal(summary.planWritten, true);
    assert.equal(summary.stepCount, 2);
    assert.equal(
      (await current.plans.read("session-1", current.plan.id)).content,
      "# Plan\n\n1. Implement.",
    );
    const finalCall = current.model.doStreamCalls[1];
    assert.equal(finalCall?.tools, undefined);
  });

  it("does not mark an empty plan as completed", async () => {
    const current = await fixture([
      toolResult("empty-plan", "plan_write", { content: "" }),
      textResult("计划内容仍需确认。", "response-empty-plan"),
    ]);
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "error");
    assert.equal(summary.planWritten, false);
  });

  it("requires a structured decision on the final plan step", async () => {
    const results = [
      ...Array.from({ length: 99 }, (_, index) =>
        toolResult(`empty-plan-${index}`, "plan_write", { content: "" }),
      ),
      toolResult("question", "request_user_input", {
        questions: [
          {
            id: "region",
            header: "部署区域",
            question: "请选择部署区域",
            recommendedOptionId: "cn",
            options: [
              { id: "cn", label: "中国大陆" },
              { id: "global", label: "全球" },
            ],
          },
        ],
      }),
    ];
    const current = await fixture(results);
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "awaiting-user");
    assert.equal(summary.planWritten, false);
    assert.equal(summary.stepCount, 100);
    assert.deepEqual(
      current.model.doStreamCalls[98]?.tools?.map((tool) => tool.name),
      ["plan_write", "request_user_input"],
    );
    assert.deepEqual(
      current.model.doStreamCalls[99]?.tools?.map((tool) => tool.name),
      ["plan_write", "request_user_input"],
    );
    assert.equal((await current.plans.read("session-1", current.plan.id)).content, "");
  }, 15_000);

  it("stops repeated reads on the third unchanged result and records tool-loop", async () => {
    const current = await fixture([
      toolResult("read-1", "read_file", { path: "source.txt" }),
      toolResult("read-2", "read_file", { path: "./source.txt", startLine: 1 }),
      toolResult("read-3", "read_file", { path: "source.txt" }),
      toolResult("plan", "plan_write", { content: "# Recovery plan\n\nStop rereading." }),
      textResult("已停止重复调研并写入计划。", "response-loop-final"),
    ]);
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "error");
    assert.equal(summary.stopReason, "tool-loop");
    assert.equal(summary.duplicateToolCallCount, 2);
    assert.equal(summary.toolCallCount, 4);
    assert.equal(summary.planWritten, true);
    assert.deepEqual(
      current.model.doStreamCalls[3]?.tools?.map((tool) => tool.name),
      ["plan_write", "request_user_input"],
    );
    assert.ok(current.events.published.some((event) => event.type === "run.error"));
  });

  it("records checkpoint and main model invocations separately", async () => {
    const messages: ChatSession["messages"] = Array.from({ length: 21 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      parts: [
        {
          type: "text" as const,
          text: index < 14 ? `old evidence ${"x".repeat(2_000)}` : `recent-${index}`,
        },
      ],
    }));
    const current = await fixture(
      [
        toolResult("question", "request_user_input", {
          questions: [
            {
              id: "release-window",
              header: "发布窗口",
              question: "请选择发布窗口",
              recommendedOptionId: "weekday",
              options: [
                { id: "weekday", label: "工作日" },
                { id: "weekend", label: "周末" },
              ],
            },
          ],
        }),
      ],
      {
        inputContext: 8_000,
        messages,
        planContent: "# Current plan\n\nPreserve this exact body.",
        doGenerate: checkpointResult(
          "Goal\nContinue the plan\n\nUser constraints\nPreserve evidence\n\nConfirmed facts and sources\nNone\n\nFiles and queries checked\nNone\n\nDecisions made\nNone\n\nOpen questions\nRelease window\n\nNext step\nAsk user",
        ),
      },
    );
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "awaiting-user");
    assert.equal(summary.compactionCount, 1);
    assert.equal(summary.modelCallCount, 2);
    assert.deepEqual(
      current.usageLogs
        .list()
        .map((entry) => entry.operation)
        .sort(),
      ["chat-run", "context-checkpoint"],
    );
    assert.ok(current.events.published.some((event) => event.type === "context.compacted"));
    assert.match(
      JSON.stringify(current.model.doStreamCalls[0]?.prompt),
      /Preserve this exact body/,
    );
  });

  it("fails the run when checkpoint generation fails", async () => {
    const messages: ChatSession["messages"] = Array.from({ length: 21 }, (_, index) => ({
      id: `message-${index}`,
      role: index % 2 === 0 ? ("user" as const) : ("assistant" as const),
      parts: [{ type: "text" as const, text: index < 14 ? "x".repeat(2_000) : "recent" }],
    }));
    const current = await fixture([], {
      inputContext: 8_000,
      messages,
      doGenerate: async () => {
        throw new Error("checkpoint unavailable");
      },
    });
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "error");
    assert.equal(summary.stopReason, "checkpoint-failed");
    assert.ok(current.events.published.some((event) => event.type === "run.error"));
  });

  it("treats a length finish and a stream without finish as incomplete", async () => {
    const lengthRun = await fixture([textResult("partial", "response-length", "length")]);
    const lengthSummary = await finishRun(lengthRun);
    assert.equal(lengthSummary.outcome, "error");
    assert.equal(lengthSummary.stopReason, "context-limit");

    const eofRun = await fixture([
      streamResult([
        { type: "stream-start", warnings: [] },
        { type: "text-start", id: "eof-text" },
        { type: "text-delta", id: "eof-text", delta: "partial" },
        { type: "text-end", id: "eof-text" },
      ]),
    ]);
    const eofSummary = await finishRun(eofRun);
    assert.equal(eofSummary.outcome, "error");
    assert.equal(eofSummary.stopReason, "incomplete-response");
    const eofSession = await eofRun.store.get("session-1");
    assert.equal(
      eofSession?.messages.at(-1)?.parts.find((part) => part.type === "text")?.text,
      "partial",
    );
    assert.ok(eofRun.activityLogs.list().some((entry) => entry.message === "模型响应流未完整结束"));
  });

  it("explains a model stream that closes without any content", async () => {
    const current = await fixture([streamResult([])]);
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "error");
    assert.equal(summary.stopReason, "incomplete-response");

    const session = await current.store.get("session-1");
    assert.equal(
      session?.messages.at(-1)?.parts.find((part) => part.type === "text")?.text,
      "模型连接已结束，但未返回任何内容。请重试。",
    );
    const diagnostic = current.activityLogs
      .list()
      .find((entry) => entry.message === "模型响应流未完整结束");
    assert.match(diagnostic?.details ?? "", /"terminalObserved":false/);
  });

  it("persists a user stop as a non-error outcome", async () => {
    const delayed = {
      stream: simulateReadableStream({
        initialDelayInMs: 100,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "delayed-text" },
          { type: "text-delta", id: "delayed-text", delta: "late response" },
          { type: "text-end", id: "delayed-text" },
          {
            type: "finish",
            finishReason: { unified: "stop", raw: "stop" },
            usage: usage(),
          },
        ] satisfies MockStreamPart[],
      }),
    } satisfies MockStreamResult;
    const current = await fixture([delayed]);
    const response = await current.registry.start("session-1", {
      modelId: "mock",
      planMode: "plan",
      planId: current.plan.id,
      toolNames: ["read_file"],
    });
    const body = response.text().catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(current.registry.stop("session-1"), true);
    await body;
    for (let attempt = 0; attempt < 200 && current.registry.activeCount() > 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const session = await current.store.get("session-1");
    const summary = session?.messages.at(-1)?.metadata as { runSummary?: ChatRunSummary };
    assert.equal(summary.runSummary?.outcome, "stopped");
    assert.equal(summary.runSummary?.stopReason, "user");
    assert.equal(current.registry.statusMap().get("session-1"), "ready");
  });

  it("forces the 100th apply step to produce a text-only handoff", async () => {
    const results = [
      ...Array.from({ length: 99 }, (_, index) =>
        toolResult(`todo-${index}`, "todo_write", {
          todos: [{ content: `step ${index}`, status: "in_progress" }],
        }),
      ),
      textResult("Reached the step budget; work remains.", "response-step-limit"),
    ];
    const current = await fixture(results, { planMode: "apply" });
    const summary = await finishRun(current);
    assert.equal(summary.outcome, "error");
    assert.equal(summary.stopReason, "step-limit");
    assert.equal(summary.stepCount, 100);
    assert.equal(current.model.doStreamCalls[99]?.tools, undefined);
  }, 15_000);
});
