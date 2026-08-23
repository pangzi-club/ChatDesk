function promoteChoiceUsage(value: unknown) {
  if (!value || typeof value !== "object") return value;
  const payload = value as { usage?: unknown; choices?: unknown };
  if (payload.usage !== undefined || !Array.isArray(payload.choices)) return value;
  const choiceUsage = payload.choices.find(
    (choice) =>
      choice && typeof choice === "object" && "usage" in choice && choice.usage !== undefined,
  );
  if (!choiceUsage || typeof choiceUsage !== "object") return value;
  return { ...payload, usage: (choiceUsage as { usage: unknown }).usage };
}

function transformSseEvent(event: string) {
  const dataLines = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());
  if (dataLines.length === 0) return event;
  const data = dataLines.join("\n");
  if (!data || data === "[DONE]") return event;
  try {
    const next = promoteChoiceUsage(JSON.parse(data));
    return event.replace(data, JSON.stringify(next));
  } catch {
    return event;
  }
}

export function normalizeProviderUsageResponse(response: Response) {
  if (!response.body || !response.headers.get("content-type")?.includes("text/event-stream")) {
    return response;
  }

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = "";
  const stream = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        const events = pending.split(/\r?\n\r?\n/);
        pending = events.pop() ?? "";
        for (const event of events)
          controller.enqueue(encoder.encode(`${transformSseEvent(event)}\n\n`));
      },
      flush(controller) {
        pending += decoder.decode();
        if (pending) controller.enqueue(encoder.encode(transformSseEvent(pending)));
      },
    }),
  );
  return new Response(stream, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}
