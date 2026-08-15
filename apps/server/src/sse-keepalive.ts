const DEFAULT_KEEPALIVE_INTERVAL_MS = 15_000;
const KEEPALIVE_CHUNK = new TextEncoder().encode(": keepalive\n\n");

type ReadOutcome =
  | { type: "read"; result: ReadableStreamReadResult<Uint8Array> }
  | { type: "keepalive" };

export function withSseKeepAlive(
  response: Response,
  intervalMs = DEFAULT_KEEPALIVE_INTERVAL_MS,
): Response {
  if (!response.body) return response;

  const reader = response.body.getReader();
  let pendingRead: Promise<ReadableStreamReadResult<Uint8Array>> | undefined;
  let finished = false;

  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (finished) return;
      pendingRead ??= reader.read();
      const read = pendingRead;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const outcome = await Promise.race<ReadOutcome>([
          read.then((result) => ({ type: "read", result })),
          new Promise((resolve) => {
            timer = setTimeout(() => resolve({ type: "keepalive" }), intervalMs);
          }),
        ]);
        if (outcome.type === "keepalive") {
          controller.enqueue(KEEPALIVE_CHUNK.slice());
          return;
        }

        pendingRead = undefined;
        if (outcome.result.done) {
          finished = true;
          controller.close();
          return;
        }
        controller.enqueue(outcome.result.value);
      } catch (error) {
        finished = true;
        controller.error(error);
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    cancel(reason) {
      finished = true;
      return reader.cancel(reason);
    },
  });

  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache, no-transform");
  headers.set("X-Accel-Buffering", "no");
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
