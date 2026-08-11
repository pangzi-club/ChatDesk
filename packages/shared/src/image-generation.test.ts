import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateImageWithApiKey,
  type ImageGenerationInput,
} from "./image-generation.ts";

const input: ImageGenerationInput = {
  model: "gpt-image-2-text-to-image",
  prompt: "test image",
  aspect_ratio: "1:1",
  resolution: "1K",
};

describe("shared image generation client", () => {
  it("creates and polls a task into the normalized result contract", async () => {
    const requests: Array<{ url: string; method: string; authorization: string }> = [];
    const result = await generateImageWithApiKey(" test-key ", input, {
      fetchImpl: async (request, init) => {
        requests.push({
          url: String(request),
          method: init?.method ?? "GET",
          authorization: String(new Headers(init?.headers).get("authorization")),
        });
        if (requests.length === 1) {
          return new Response(JSON.stringify({ code: 200, data: { taskId: "task-1" } }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(
          JSON.stringify({
            code: 200,
            data: { state: "success", resultJson: JSON.stringify({ resultUrls: ["https://example.com/image.png"] }) },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
    });

    assert.deepEqual(result, { taskId: "task-1", urls: ["https://example.com/image.png"] });
    assert.equal(requests.length, 2);
    assert.equal(requests[0]?.method, "POST");
    assert.equal(requests[1]?.method, "GET");
    assert.equal(requests[0]?.authorization, "Bearer test-key");
  });

  it("rejects an API-level failure even when HTTP succeeds", async () => {
    await assert.rejects(
      generateImageWithApiKey("test-key", input, {
        fetchImpl: async () =>
          new Response(JSON.stringify({ code: 401, msg: "invalid key", data: null }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      }),
      /invalid key/,
    );
  });
});
