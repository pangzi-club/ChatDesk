import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ChatServerClient, ChatServerError, type EventSourceLike } from "./index.ts";

describe("ChatServerClient", () => {
  it("adds bearer authentication and parses session responses", async () => {
    let requestUrl = "";
    let requestHeaders: Headers | undefined;
    const client = new ChatServerClient({
      baseUrl: "http://127.0.0.1:14317/",
      token: "test-token",
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestHeaders = new Headers(init?.headers);
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    assert.deepEqual(await client.listSessions(), []);
    assert.equal(requestUrl, "http://127.0.0.1:14317/v1/sessions");
    assert.equal(requestHeaders?.get("authorization"), "Bearer test-token");
  });

  it("surfaces structured server errors", async () => {
    const client = new ChatServerClient({
      baseUrl: "http://localhost",
      fetchImpl: async () =>
        new Response(JSON.stringify({ error: "会话不存在" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        }),
    });

    await assert.rejects(
      client.getConfig(),
      (error: unknown) =>
        error instanceof ChatServerError && error.status === 404 && error.message === "会话不存在",
    );
  });

  it("encodes attachment bytes using the server upload contract", async () => {
    let body = "";
    const client = new ChatServerClient({
      baseUrl: "http://localhost",
      fetchImpl: async (_input, init) => {
        body = String(init?.body);
        return new Response(JSON.stringify({ path: "/tmp/file" }), { status: 200 });
      },
    });

    assert.deepEqual(
      await client.uploadAttachment("session", "attachment", "a.txt", new Uint8Array([65, 66])),
      { path: "/tmp/file" },
    );
    assert.match(body, /"base64":"QUI="/);
  });

  it("dispatches typed SSE events through the injected event source", () => {
    const listeners = new Map<string, (event: { data: string }) => void>();
    const source: EventSourceLike = {
      onerror: null,
      onopen: null,
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      close() {},
    };
    const snapshots: string[] = [];
    const deltas: string[] = [];
    const compactions: number[] = [];
    const contextUsages: number[] = [];
    const progressSteps: number[] = [];
    const completedRuns: string[] = [];
    const client = new ChatServerClient({
      baseUrl: "http://localhost",
      token: "sse-token",
      eventSourceFactory: (url) => {
        assert.equal(url, "http://localhost/v1/events?token=sse-token");
        return source;
      },
    });

    const cleanup = client.subscribeEvents({
      onSnapshot: (sessions) => snapshots.push(String(sessions.length)),
      onDelta: (event) => deltas.push(event.delta ?? ""),
      onContextCompacted: (event) =>
        compactions.push(event.contextCompaction?.estimatedTokensBefore ?? 0),
      onContextUsage: (event) => contextUsages.push(event.contextUsage?.inputTokens ?? 0),
      onRunProgress: (event) => progressSteps.push(event.runProgress?.stepCount ?? 0),
      onRunDone: (event) => completedRuns.push(event.runSummary?.outcome ?? "missing"),
    });
    listeners.get("snapshot")?.({ data: "[]" });
    listeners.get("message.delta")?.({
      data: JSON.stringify({
        id: "event-1",
        type: "message.delta",
        sessionId: "session-1",
        delta: "hello",
        timestamp: new Date().toISOString(),
      }),
    });
    listeners.get("context.compacted")?.({
      data: JSON.stringify({
        id: "event-2",
        type: "context.compacted",
        sessionId: "session-1",
        contextCompaction: {
          count: 1,
          stepNumber: 2,
          estimatedTokensBefore: 120_000,
          estimatedTokensAfter: 48_000,
        },
        timestamp: new Date().toISOString(),
      }),
    });
    listeners.get("context.usage")?.({
      data: JSON.stringify({
        id: "event-3",
        type: "context.usage",
        sessionId: "session-1",
        contextUsage: { inputTokens: 48_500, source: "provider", stepNumber: 2 },
        timestamp: new Date().toISOString(),
      }),
    });
    listeners.get("run.progress")?.({
      data: JSON.stringify({
        id: "event-4",
        type: "run.progress",
        sessionId: "session-1",
        runProgress: {
          runId: "run-1",
          phase: "working",
          stepCount: 18,
          modelCallCount: 17,
          toolCallCount: 17,
          duplicateToolCallCount: 0,
          compactionCount: 0,
          planWritten: false,
          planMode: "plan",
        },
        timestamp: new Date().toISOString(),
      }),
    });
    listeners.get("run.done")?.({
      data: JSON.stringify({
        id: "event-5",
        type: "run.done",
        sessionId: "session-1",
        runSummary: {
          runId: "run-1",
          outcome: "completed",
          stepCount: 18,
          modelCallCount: 18,
          toolCallCount: 17,
          duplicateToolCallCount: 0,
          compactionCount: 0,
          planWritten: true,
        },
        timestamp: new Date().toISOString(),
      }),
    });
    cleanup();

    assert.deepEqual(snapshots, ["0"]);
    assert.deepEqual(deltas, ["hello"]);
    assert.deepEqual(compactions, [120_000]);
    assert.deepEqual(contextUsages, [48_500]);
    assert.deepEqual(progressSteps, [18]);
    assert.deepEqual(completedRuns, ["completed"]);
  });
});
