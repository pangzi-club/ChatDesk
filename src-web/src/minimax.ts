import { normalizeProviderUsageResponse } from "./provider-usage.ts";

export type MiniMaxModelInput = {
  name: string;
  provider?: string;
  baseUrl?: string;
};

export function isMiniMaxModel(model: MiniMaxModelInput) {
  const provider = model.provider?.toLowerCase() ?? "";
  const baseUrl = model.baseUrl?.toLowerCase() ?? "";
  const name = model.name.toLowerCase();
  return (
    provider.includes("minimax") ||
    baseUrl.includes("minimaxi") ||
    name.startsWith("minimax-")
  );
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

export function createMiniMaxFetch(model: MiniMaxModelInput) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isMiniMaxModel(model) || !init?.body || typeof init.body !== "string") {
      return fetch(input, init);
    }

    const url = requestUrl(input);
    if (!url.pathname.endsWith("/chat/completions")) return fetch(input, init);

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(init.body) as unknown;
      if (!parsed || typeof parsed !== "object") return fetch(input, init);
      body = parsed as Record<string, unknown>;
    } catch {
      return fetch(input, init);
    }

    body.reasoning_split ??= true;
    if (model.name.toLowerCase() === "minimax-m3") {
      body.thinking ??= { type: "adaptive" };
    }

    if (body.stream === true) {
      const streamOptions = (body.stream_options ?? {}) as Record<string, unknown>;
      body.stream_options = { ...streamOptions, include_usage: true };
    }
    return normalizeProviderUsageResponse(await fetch(input, { ...init, body: JSON.stringify(body) }));
  };
}
