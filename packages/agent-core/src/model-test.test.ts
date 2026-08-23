import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";
import { listProviderModels } from "./model-test.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("OpenAI-compatible model listing", () => {
  it("requests MiniMax models from the provider v1 endpoint", async () => {
    let requestUrl = "";
    let authorization = "";
    globalThis.fetch = async (input, init) => {
      requestUrl = String(input);
      authorization = new Headers(init?.headers).get("Authorization") ?? "";
      return new Response(
        JSON.stringify({
          object: "list",
          data: [{ id: "MiniMax-M3", object: "model", owned_by: "minimax" }],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    };

    const models = await listProviderModels({
      baseUrl: "https://api.minimaxi.com/v1",
      apiKey: "test-key",
    });

    assert.equal(requestUrl, "https://api.minimaxi.com/v1/models");
    assert.equal(authorization, "Bearer test-key");
    assert.deepEqual(models, [
      {
        id: "MiniMax-M3",
        contextLength: undefined,
        supportsImageIn: false,
        supportsVideoIn: false,
        supportsReasoning: false,
      },
    ]);
  });
});
