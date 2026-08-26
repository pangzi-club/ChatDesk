import assert from "node:assert/strict";
import { afterEach, describe, it, vi } from "vitest";
import { ChatServerClient, ChatServerError, type EventSourceLike } from "./index.ts";

describe("ChatServerClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
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

    assert.deepEqual(await client.listSessions({ query: "设计 方案", limit: 10 }), []);
    assert.equal(
      requestUrl,
      "http://127.0.0.1:14317/v1/sessions?query=%E8%AE%BE%E8%AE%A1+%E6%96%B9%E6%A1%88&limit=10",
    );
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

  it("creates a fork request from a message", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const forked = { id: "forked-session", title: "Fork-原会话" };
    const client = new ChatServerClient({
      baseUrl: "http://localhost",
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(JSON.stringify(forked), { status: 201 });
      },
    });

    assert.deepEqual(
      await client.forkSession("source/session", { messageId: "assistant-1" }),
      forked,
    );
    assert.equal(requestUrl, "http://localhost/v1/sessions/source%2Fsession/fork");
    assert.deepEqual(JSON.parse(String(requestInit?.body)), { messageId: "assistant-1" });
  });

  it("updates a session title with the title endpoint", async () => {
    let requestUrl = "";
    let requestInit: RequestInit | undefined;
    const client = new ChatServerClient({
      baseUrl: "http://localhost",
      fetchImpl: async (input, init) => {
        requestUrl = String(input);
        requestInit = init;
        return new Response(JSON.stringify({ title: "新标题" }), { status: 200 });
      },
    });

    assert.deepEqual(await client.updateSessionTitle("source/session", "新标题"), {
      title: "新标题",
    });
    assert.equal(requestUrl, "http://localhost/v1/sessions/source%2Fsession/title");
    assert.equal(requestInit?.method, "PUT");
    assert.deepEqual(JSON.parse(String(requestInit?.body)), { title: "新标题" });
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

  it("downloads attachment bytes as an array buffer", async () => {
    const client = new ChatServerClient({
      baseUrl: "http://localhost",
      fetchImpl: async (input) => {
        assert.equal(String(input), "http://localhost/v1/sessions/session/attachments/attachment");
        return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      },
    });
    assert.deepEqual(
      await client.downloadAttachment("session", "attachment"),
      new Uint8Array([1, 2, 3]),
    );
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
    const contextUsages: Array<{ inputTokens: number; cacheReadTokens?: number }> = [];
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
      onContextUsage: (event) => {
        if (event.contextUsage) contextUsages.push(event.contextUsage);
      },
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
        contextUsage: {
          inputTokens: 48_500,
          cacheReadTokens: 32_000,
          source: "provider",
          stepNumber: 2,
        },
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
    assert.deepEqual(contextUsages, [
      { inputTokens: 48_500, cacheReadTokens: 32_000, source: "provider", stepNumber: 2 },
    ]);
    assert.deepEqual(progressSteps, [18]);
    assert.deepEqual(completedRuns, ["completed"]);
  });

  it("refreshes the SSE token before reconnecting", async () => {
    vi.useFakeTimers();
    let token = "old-token";
    const urls: string[] = [];
    const sources: EventSourceLike[] = [];
    const client = new ChatServerClient({
      baseUrl: "http://localhost",
      token: () => token,
      onBeforeReconnect: () => {
        token = "new-token";
      },
      eventSourceFactory: (url) => {
        urls.push(url);
        const source: EventSourceLike = {
          onerror: null,
          onopen: null,
          addEventListener() {},
          close() {},
        };
        sources.push(source);
        return source;
      },
    });

    const cleanup = client.subscribeEvents({});
    assert.deepEqual(urls, ["http://localhost/v1/events?token=old-token"]);

    sources[0]?.onerror?.();
    await vi.advanceTimersByTimeAsync(1000);
    assert.deepEqual(urls, [
      "http://localhost/v1/events?token=old-token",
      "http://localhost/v1/events?token=new-token",
    ]);

    cleanup();
  });
});
