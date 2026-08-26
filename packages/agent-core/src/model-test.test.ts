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
        outputContext: undefined,
        supportsTools: false,
        supportsImageIn: false,
        supportsVideoIn: false,
        supportsReasoning: false,
        inputPricePerMillion: undefined,
        outputPricePerMillion: undefined,
        cacheReadPricePerMillion: undefined,
        cacheWritePricePerMillion: undefined,
      },
    ]);
  });

  it("normalizes OpenRouter model capabilities and pricing", async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          data: [
            {
              id: "anthropic/claude-sonnet-4",
              context_length: 200_000,
              architecture: { input_modalities: ["text", "image"] },
              supported_parameters: ["tools", "reasoning"],
              top_provider: { max_completion_tokens: 64_000 },
              pricing: {
                prompt: "0.000003",
                completion: "0.000015",
                input_cache_read: "0.0000003",
                input_cache_write: "0.00000375",
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );

    const models = await listProviderModels({
      baseUrl: "https://openrouter.ai/api/v1/chat/completions",
      apiKey: "test-key",
    });

    assert.deepEqual(models, [
      {
        id: "anthropic/claude-sonnet-4",
        contextLength: 200_000,
        outputContext: 64_000,
        supportsTools: true,
        supportsImageIn: true,
        supportsVideoIn: false,
        supportsReasoning: true,
        inputPricePerMillion: 3,
        outputPricePerMillion: 15,
        cacheReadPricePerMillion: 0.3,
        cacheWritePricePerMillion: 3.75,
      },
    ]);
  });
});
