import { normalizeProviderUsageResponse } from "./provider-usage.ts";

export type KimiModelInput = {
  name: string;
  provider?: string;
  baseUrl?: string;
};

export function isKimiModel(model: KimiModelInput) {
  const provider = model.provider?.toLowerCase() ?? "";
  const baseUrl = model.baseUrl?.toLowerCase() ?? "";
  const name = model.name.toLowerCase();
  return (
    provider.includes("kimi") ||
    provider.includes("moonshot") ||
    baseUrl.includes("moonshot") ||
    name.startsWith("kimi-")
  );
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === "string") return new URL(input);
  if (input instanceof URL) return input;
  return new URL(input.url);
}

export function createKimiFetch(model: KimiModelInput) {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    if (!isKimiModel(model) || !init?.body || model.name.toLowerCase().startsWith("moonshot-v1")) {
      return fetch(input, init);
    }

    const url = requestUrl(input);
    if (!url.pathname.endsWith("/chat/completions") || typeof init.body !== "string") {
      return fetch(input, init);
    }

    let body: Record<string, unknown>;
    try {
      const parsed = JSON.parse(init.body) as unknown;
      if (!parsed || typeof parsed !== "object") return fetch(input, init);
      body = parsed as Record<string, unknown>;
    } catch {
      return fetch(input, init);
    }

    const name = model.name.toLowerCase();
    // Kimi reasoning models use their server-side sampling defaults and reject
    // the temperature=0 value commonly emitted by OpenAI-compatible clients.
    delete body.temperature;
    if (name === "kimi-k3") {
      body.reasoning_effort ??= "max";
    } else if (name.startsWith("kimi-k2.7-code")) {
      body.thinking ??= { type: "enabled", keep: "all" };
    } else if (name === "kimi-k2.6" || name === "kimi-k2.5") {
      body.thinking ??= { type: "enabled" };
    }

    if (body.stream === true) {
      const streamOptions = (body.stream_options ?? {}) as Record<string, unknown>;
      body.stream_options = { ...streamOptions, include_usage: true };
    }
    return normalizeProviderUsageResponse(
      await fetch(input, { ...init, body: JSON.stringify(body) }),
    );
  };
}
