import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { MockLanguageModelV4, simulateReadableStream } from "ai/test";
import { afterEach, describe, it } from "vitest";
import { openCliSession } from "./cli-session.ts";

type MockStreamResult = Awaited<ReturnType<MockLanguageModelV4["doStream"]>>;

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function textResult(text: string, responseId: string): MockStreamResult {
  return {
    stream: simulateReadableStream({
      chunks: [
        { type: "stream-start", warnings: [] },
        { type: "response-metadata", id: responseId, modelId: "mock-model" },
        { type: "text-start", id: `${responseId}-text` },
        { type: "text-delta", id: `${responseId}-text`, delta: text },
        { type: "text-end", id: `${responseId}-text` },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage: {
            inputTokens: {
              total: 4,
              noCache: 4,
              cacheRead: 0,
              cacheWrite: 0,
            },
            outputTokens: { total: 2, text: 2, reasoning: 0 },
          },
        },
      ],
    }),
  };
}

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chatdesk-cli-session-"));
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

describe("openCliSession", () => {
  it("reuses the same session across multiple local turns", async () => {
    const { dataDir, cwd } = await fixture();
    const model = new MockLanguageModelV4({
      provider: "mock-provider",
      modelId: "mock-model",
      doStream: [textResult("第一轮回答", "turn-1"), textResult("第二轮回答", "turn-2")],
    });
    const session = await openCliSession({
      dataDir,
      cwd,
      acquireLock: false,
      createLanguageModel: () => model,
    });
    try {
      const first = await session.submit("第一轮");
      const second = await session.submit("第二轮");
      const sessionId = session.sessionId;
      assert.equal(first.text, "第一轮回答");
      assert.equal(second.text, "第二轮回答");
      assert.equal(first.modelLabel, second.modelLabel);
      await session.close();
      const { createAgentCore } = await import("@chatdesk/agent-core");
      const core = await createAgentCore({ dataDir, acquireLock: false });
      try {
        const saved = await core.store.get(sessionId);
        assert.equal(saved?.messages.filter((message) => message.role === "user").length, 2);
        assert.equal(saved?.messages.filter((message) => message.role === "assistant").length, 2);
      } finally {
        await core.shutdown();
      }
    } catch (error) {
      await session.close();
      throw error;
    }
  });
});
