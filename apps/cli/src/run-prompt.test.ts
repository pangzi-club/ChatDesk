import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_ID } from "@chatdesk/shared";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { afterEach, describe, it } from "vitest";
import { CLI_DEFAULT_TOOL_NAMES, runPrompt } from "./run-prompt.ts";

type MockStreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;

const directories: string[] = [];

function capture(lines: string[]) {
  return (chunk: string | Uint8Array) => {
    lines.push(String(chunk));
    return true;
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function usage() {
  return {
    inputTokens: {
      total: 10,
      noCache: 7,
      cacheRead: 2,
      cacheWrite: 1,
    },
    outputTokens: { total: 3, text: 2, reasoning: 1 },
  };
}

function textResult(text: string, responseId: string): MockStreamResult {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "response-metadata", id: responseId, modelId: "mock-model" },
        { type: "text-start", id: `${responseId}-text` },
        { type: "text-delta", id: `${responseId}-text`, delta: text },
        { type: "text-end", id: `${responseId}-text` },
        { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: usage() },
      ],
    }),
  };
}

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chatdesk-cli-"));
  directories.push(parent);
  const dataDir = path.join(parent, "chat-server");
  const cwd = path.join(parent, "project");
  await mkdir(dataDir, { recursive: true });
  await mkdir(cwd, { recursive: true });
  await writeFile(
    path.join(dataDir, "settings.json"),
    JSON.stringify({
      models: [
        {
          id: "mock",
          name: "mock-model",
          provider: "openai-compatible",
          baseUrl: "http://mock.invalid/v1",
          apiKey: "test-key",
          supportsTools: true,
          isDefault: true,
        },
      ],
    }),
    "utf8",
  );
  return { dataDir, cwd };
}

describe("runPrompt", () => {
  it("enables workspace and web tools by default", () => {
    assert.deepEqual(CLI_DEFAULT_TOOL_NAMES, [
      "list_dir",
      "search_files",
      "read_file",
      "write_file",
      "edit_file",
      "apply_patch",
      "bash",
      "web_search",
      "web_fetch",
    ]);
  });

  it("prints the final assistant text and binds cwd as a real workspace", async () => {
    const { dataDir, cwd } = await fixture();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const model = new MockLanguageModelV4({
      provider: "mock-provider",
      modelId: "mock-model",
      doStream: [textResult("今天多云，气温适宜。", "cli-response")],
    });

    const code = await runPrompt({
      prompt: "今天天气怎么样",
      dataDir,
      cwd,
      stdout: { write: capture(stdout) },
      stderr: { write: capture(stderr) },
      createLanguageModel: () => model,
    });

    assert.equal(code, 0);
    assert.equal(stdout.join(""), "今天多云，气温适宜。\n");
    assert.equal(stderr.join(""), "");

    const { createAgentCore } = await import("@chatdesk/agent-core");
    const core = await createAgentCore({ dataDir, acquireLock: false });
    try {
      const sessions = await core.store.list();
      assert.equal(sessions.length, 1);
      const session = await core.store.get(sessions[0]?.id ?? "");
      assert.ok(session);
      assert.equal(session.source, "cli");
      assert.equal(session.cwd, cwd);
      assert.notEqual(session.workspaceId, DEFAULT_WORKSPACE_ID);
      const workspace = core.workspaces.get(session.workspaceId ?? "");
      assert.equal(workspace?.path, cwd);
    } finally {
      await core.shutdown();
    }
  });

  it("fails when the workspace directory is missing", async () => {
    const { dataDir } = await fixture();
    const stderr: string[] = [];
    const code = await runPrompt({
      prompt: "hello",
      dataDir,
      cwd: path.join(dataDir, "missing-project"),
      stdout: { write: () => true },
      stderr: { write: capture(stderr) },
    });
    assert.equal(code, 1);
    assert.match(stderr.join(""), /workspace 目录不存在/);
  });

  it("fails when no model is configured", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "chatdesk-cli-empty-"));
    directories.push(parent);
    const dataDir = path.join(parent, "chat-server");
    const cwd = path.join(parent, "project");
    await mkdir(dataDir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    const stderr: string[] = [];
    const code = await runPrompt({
      prompt: "hello",
      dataDir,
      cwd,
      stdout: { write: () => true },
      stderr: { write: capture(stderr) },
    });
    assert.equal(code, 1);
    assert.match(stderr.join(""), /未配置可用模型/);
  });

  it("prints markdown without ANSI and a verbose summary to stdout", async () => {
    const { dataDir, cwd } = await fixture();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const model = new MockLanguageModelV4({
      provider: "mock-provider",
      modelId: "mock-model",
      doStream: [textResult("这是 **重点**。", "cli-verbose")],
    });

    const code = await runPrompt({
      prompt: "总结",
      dataDir,
      cwd,
      verbose: true,
      stdout: { write: capture(stdout) },
      stderr: { write: capture(stderr) },
      createLanguageModel: () => model,
    });

    assert.equal(code, 0);
    const output = stdout.join("");
    assert.match(output, /这是 重点。/);
    assert.doesNotMatch(output, /\*\*重点\*\*/);
    assert.equal(output.includes("\u001b["), false);
    assert.match(output, /模型: mock/);
    assert.match(output, /结果: completed/);
    assert.match(output, /步数:/);
    assert.equal(stderr.join(""), "");
  });

  it("prints the attached Chat Server summary to stdout", async () => {
    const { dataDir, cwd } = await fixture();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const summary = {
      runId: "run-attached",
      outcome: "completed" as const,
      stepCount: 3,
      modelCallCount: 2,
      toolCallCount: 1,
      duplicateToolCallCount: 0,
      compactionCount: 1,
      planWritten: false,
      failedToolCallCount: 0,
      touchedPaths: ["src/a.ts"],
      durationMs: 2100,
    };
    const usage = {
      inputTokens: 11,
      outputTokens: 4,
      cacheReadTokens: 3,
      reasoningOutputTokens: 2,
    };
    const messages: Array<{
      id: string;
      role: "user" | "assistant";
      parts: Array<{ type: "text"; text: string }>;
      metadata?: { runSummary: typeof summary; usage: typeof usage };
    }> = [];

    const code = await runPrompt({
      prompt: "hello",
      dataDir,
      cwd,
      verbose: true,
      stdout: { write: capture(stdout) },
      stderr: { write: capture(stderr) },
      connectServer: async () => ({
        health: async () => ({ ok: true }),
        getConfig: async () => ({
          models: [
            {
              id: "server-model",
              name: "server-model",
              provider: "openai-compatible",
              baseUrl: "http://mock.invalid/v1",
              apiKey: "test-key",
              isDefault: true,
            },
          ],
          apiKeys: {},
        }),
        createSession: async (options) => ({
          id: "session-attached",
          workspaceId: "ws-1",
          cwd: options.cwd,
        }),
        startRunAndWait: async (_sessionId, input) => {
          if (input.message) messages.push(input.message as (typeof messages)[number]);
          messages.push({
            id: "assistant-1",
            role: "assistant",
            parts: [{ type: "text", text: "服务器回答" }],
            metadata: { runSummary: summary, usage },
          });
          return {
            done: {
              id: "event-1",
              type: "run.done",
              sessionId: "session-attached",
              runSummary: summary,
              timestamp: new Date().toISOString(),
            },
          };
        },
        loadSession: async () =>
          ({
            id: "session-attached",
            messages,
          }) as never,
        stopRun: async () => ({ stopped: true }),
      }),
    });

    assert.equal(code, 0);
    const output = stdout.join("");
    assert.match(output, /服务器回答/);
    assert.match(output, /模型: server-model/);
    assert.match(output, /结果: completed/);
    assert.match(output, /失败工具: 0 {2}上下文压缩: 1/);
    assert.match(output, /修改文件: src\/a.ts/);
    assert.match(output, /token: 输入 11 {2}输出 4 {2}缓存 3 {2}推理 2/);
    assert.equal(stderr.join(""), "");
  });

  it("returns 1 when aborted, empty, or failed", async () => {
    const { dataDir, cwd } = await fixture();
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(
      await runPrompt({
        prompt: "hello",
        dataDir,
        cwd,
        signal: aborted.signal,
        stdout: { write: () => true },
        stderr: { write: () => true },
        createLanguageModel: () =>
          new MockLanguageModelV4({
            provider: "mock-provider",
            modelId: "mock-model",
            doStream: [textResult("should not run", "abort")],
          }),
      }),
      1,
    );

    const emptyStderr: string[] = [];
    assert.equal(
      await runPrompt({
        prompt: "hello",
        dataDir,
        cwd,
        stdout: { write: () => true },
        stderr: { write: capture(emptyStderr) },
        connectServer: async () => ({
          health: async () => ({ ok: true }),
          getConfig: async () => ({
            models: [
              {
                id: "server-model",
                name: "server-model",
                baseUrl: "http://mock.invalid/v1",
                apiKey: "test-key",
                isDefault: true,
              },
            ],
            apiKeys: {},
          }),
          createSession: async () => ({ id: "session-empty", cwd }),
          startRunAndWait: async () => ({
            done: {
              id: "event-empty",
              type: "run.done",
              sessionId: "session-empty",
              runSummary: {
                runId: "run-empty",
                outcome: "completed",
                stepCount: 1,
                modelCallCount: 1,
                toolCallCount: 0,
                duplicateToolCallCount: 0,
                compactionCount: 0,
                planWritten: false,
              },
              timestamp: new Date().toISOString(),
            },
          }),
          loadSession: async () =>
            ({
              id: "session-empty",
              messages: [
                {
                  id: "assistant-empty",
                  role: "assistant",
                  parts: [{ type: "text", text: "   " }],
                },
              ],
            }) as never,
          stopRun: async () => ({ stopped: true }),
        }),
      }),
      1,
    );
    assert.match(emptyStderr.join(""), /模型没有返回内容/);

    const failedStderr: string[] = [];
    assert.equal(
      await runPrompt({
        prompt: "hello",
        dataDir,
        cwd,
        stdout: { write: () => true },
        stderr: { write: capture(failedStderr) },
        connectServer: async () => ({
          health: async () => ({ ok: true }),
          getConfig: async () => ({
            models: [
              {
                id: "server-model",
                name: "server-model",
                baseUrl: "http://mock.invalid/v1",
                apiKey: "test-key",
                isDefault: true,
              },
            ],
            apiKeys: {},
          }),
          createSession: async () => ({ id: "session-error", cwd }),
          startRunAndWait: async () => ({
            error: {
              id: "event-error",
              type: "run.error",
              sessionId: "session-error",
              runSummary: {
                runId: "run-error",
                outcome: "error",
                stopReason: "tool-errors",
                stepCount: 1,
                modelCallCount: 1,
                toolCallCount: 1,
                duplicateToolCallCount: 0,
                compactionCount: 0,
                planWritten: false,
              },
              timestamp: new Date().toISOString(),
            },
          }),
          loadSession: async () =>
            ({
              id: "session-error",
              messages: [
                {
                  id: "assistant-error",
                  role: "assistant",
                  parts: [{ type: "text", text: "" }],
                  metadata: {
                    runSummary: {
                      runId: "run-error",
                      outcome: "error",
                      stopReason: "tool-errors",
                      stepCount: 1,
                      modelCallCount: 1,
                      toolCallCount: 1,
                      duplicateToolCallCount: 0,
                      compactionCount: 0,
                      planWritten: false,
                    },
                  },
                },
              ],
            }) as never,
          stopRun: async () => ({ stopped: true }),
        }),
      }),
      1,
    );
    assert.match(failedStderr.join(""), /运行失败：tool-errors/);
  });
});
