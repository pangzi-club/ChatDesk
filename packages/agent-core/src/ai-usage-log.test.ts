import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "vitest";
import { AiUsageLogStore } from "./ai-usage-log.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

async function dataDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chatdesk-usage-"));
  directories.push(directory);
  return directory;
}

function entry(id: string) {
  return {
    id,
    timestamp: "2026-08-15T00:00:00.000Z",
    operation: "chat-run",
    sessionId: "session-1",
    runId: "run-1",
    usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 3, reasoningOutputTokens: 1 },
  };
}

describe("AI usage JSONL persistence", () => {
  it("imports legacy entries and ignores a corrupt JSONL tail", async () => {
    const directory = await dataDirectory();
    await writeFile(path.join(directory, "ai-usage-log.json"), JSON.stringify([entry("legacy")]));
    await writeFile(
      path.join(directory, "ai-usage-log.jsonl"),
      `${JSON.stringify(entry("jsonl"))}\n{"id":"incomplete`,
    );
    const store = new AiUsageLogStore(directory);
    await store.init();
    assert.deepEqual(
      store
        .list()
        .map((item) => item.id)
        .sort(),
      ["jsonl", "legacy"],
    );
  });

  it("serializes concurrent appends without truncating the canonical log", async () => {
    const directory = await dataDirectory();
    const store = new AiUsageLogStore(directory);
    await store.init();
    await Promise.all(
      Array.from({ length: 24 }, (_, invocationIndex) =>
        store.append({
          operation: invocationIndex === 23 ? "context-checkpoint" : "chat-run",
          sessionId: "session-1",
          runId: "run-1",
          callId: `call-${invocationIndex}`,
          invocationIndex,
          providerModelId: "mock-model",
          responseId: `response-${invocationIndex}`,
          usage: { inputTokens: invocationIndex + 1, outputTokens: 1 },
        }),
      ),
    );
    const lines = (await readFile(path.join(directory, "ai-usage-log.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { callId: string });
    assert.equal(lines.length, 24);
    assert.equal(new Set(lines.map((line) => line.callId)).size, 24);
    assert.equal(store.list().length, 24);
  });
});
