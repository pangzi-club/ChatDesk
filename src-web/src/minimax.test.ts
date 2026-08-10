import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { createMiniMaxFetch } from "./minimax.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("MiniMax request compatibility", () => {
  it("enables split reasoning output for chat completion requests", async () => {
    let body = "";
    globalThis.fetch = async (_input, init) => {
      body = String(init?.body ?? "");
      return new Response("{}", { status: 200 });
    };

    await createMiniMaxFetch({ name: "MiniMax-M3", provider: "MiniMax" })(
      "https://api.minimaxi.com/v1/chat/completions",
      {
        method: "POST",
        body: JSON.stringify({ model: "MiniMax-M3", messages: [] }),
      },
    );

    assert.deepEqual(JSON.parse(body), {
      model: "MiniMax-M3",
      messages: [],
      reasoning_split: true,
      thinking: { type: "adaptive" },
    });
  });
});
