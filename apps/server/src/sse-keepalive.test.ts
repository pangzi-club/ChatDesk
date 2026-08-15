import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { withSseKeepAlive } from "./sse-keepalive.ts";

const decoder = new TextDecoder();

describe("withSseKeepAlive", () => {
  it("emits invisible SSE comments while the source is idle", async () => {
    let sourceController: ReadableStreamDefaultController<Uint8Array> | undefined;
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        sourceController = controller;
      },
    });
    const response = withSseKeepAlive(
      new Response(source, { headers: { "Content-Type": "text/event-stream" } }),
      5,
    );
    const reader = response.body?.getReader();
    assert.ok(reader);

    const heartbeat = await reader.read();
    assert.equal(decoder.decode(heartbeat.value), ": keepalive\n\n");

    sourceController?.enqueue(new TextEncoder().encode('data: {"type":"start"}\n\n'));
    sourceController?.close();
    const payload = await reader.read();
    assert.equal(decoder.decode(payload.value), 'data: {"type":"start"}\n\n');
    assert.equal((await reader.read()).done, true);
    assert.equal(response.headers.get("cache-control"), "no-cache, no-transform");
    assert.equal(response.headers.get("x-accel-buffering"), "no");
  });

  it("propagates client cancellation to the source stream", async () => {
    let cancelledWith: unknown;
    const source = new ReadableStream<Uint8Array>({
      cancel(reason) {
        cancelledWith = reason;
      },
    });
    const reader = withSseKeepAlive(new Response(source), 5).body?.getReader();
    assert.ok(reader);
    await reader.read();

    const reason = new TypeError("Load failed");
    await reader.cancel(reason);
    assert.equal(cancelledWith, reason);
  });
});
