import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { cliTurnEventFromServer, snapshotFromMessage } from "./turn-events.ts";

describe("CLI turn events", () => {
  it("extracts text and compact tool activities", () => {
    const snapshot = snapshotFromMessage({
      role: "assistant",
      parts: [
        { type: "text", text: "正在检查" },
        {
          type: "tool-read_file",
          toolCallId: "read-1",
          state: "output-available",
          input: { path: "/workspace/package.json" },
          output: { path: "/workspace/package.json" },
        },
        {
          type: "tool-bash",
          toolCallId: "bash-1",
          state: "output-error",
          input: { command: "pnpm check" },
          errorText: "command failed",
        },
      ],
    });

    assert.equal(snapshot.text, "正在检查");
    assert.deepEqual(snapshot.tools, [
      {
        id: "read-1",
        name: "read_file",
        detail: "package.json",
        status: "completed",
      },
      {
        id: "bash-1",
        name: "bash",
        detail: "pnpm check",
        status: "error",
        error: "command failed",
      },
    ]);
  });

  it("normalizes deltas and progress", () => {
    assert.deepEqual(
      cliTurnEventFromServer({
        id: "event-1",
        type: "message.delta",
        sessionId: "session-1",
        delta: "hello",
        timestamp: new Date().toISOString(),
      }),
      { type: "text-delta", delta: "hello" },
    );
    const progress = cliTurnEventFromServer({
      id: "event-2",
      type: "run.progress",
      sessionId: "session-1",
      timestamp: new Date().toISOString(),
      runProgress: {
        runId: "run-1",
        phase: "working",
        stepCount: 2,
        modelCallCount: 2,
        toolCallCount: 1,
        duplicateToolCallCount: 0,
        compactionCount: 0,
        planWritten: false,
        failedToolCallCount: 0,
        truncatedToolResultCount: 0,
        touchedPaths: [],
        planMode: "apply",
        startedAt: new Date().toISOString(),
      },
    });
    assert.deepEqual(progress, {
      type: "progress",
      progress: { phase: "working", stepCount: 2, toolCallCount: 1 },
    });
  });
});
