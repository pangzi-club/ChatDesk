import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_WORKSPACE_ID } from "@chatdesk/shared";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { afterEach, describe, it } from "vitest";
import { runPrompt } from "./run-prompt.ts";

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
});
