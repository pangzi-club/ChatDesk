import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createKimiFetch } from "./kimi.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Kimi request compatibility", () => {
  it("adds Kimi thinking parameters to chat completion requests", async () => {
    let body = "";
    globalThis.fetch = async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response("{}", { status: 200 });
    };

    await createKimiFetch({ name: "kimi-k2.7-code", provider: "Kimi / Moonshot" })(
      "https://api.moonshot.cn/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ model: "kimi-k2.7-code", messages: [], temperature: 0 }),
      },
    );

    assert.deepEqual(JSON.parse(body), {
      model: "kimi-k2.7-code",
      messages: [],
      thinking: { type: "enabled", keep: "all" },
    });
  });

  it("requests usage in streaming chat completion responses", async () => {
    let body = "";
    globalThis.fetch = async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response("{}", { status: 200 });
    };

    await createKimiFetch({ name: "kimi-k2.6", provider: "Kimi / Moonshot" })(
      "https://api.moonshot.cn/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ model: "kimi-k2.6", messages: [], stream: true }),
      },
    );

    assert.deepEqual(JSON.parse(body).stream_options, { include_usage: true });
  });
});
