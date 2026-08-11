import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizeProviderUsageResponse } from "./provider-usage.ts";

describe("provider usage normalization", () => {
  it("promotes usage from a provider choice to the stream chunk", async () => {
    const response = new Response(
      [
        'data: {"choices":[{"delta":{"content":"ok"},"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}]}',
        "",
        "data: [DONE]",
        "",
      ].join("\n"),
      { headers: { "Content-Type": "text/event-stream" } },
    );

    const normalized = normalizeProviderUsageResponse(response);
    const text = await normalized.text();
    const firstEvent = JSON.parse(text.split("\n")[0].slice(6));

    assert.deepEqual(firstEvent.usage, {
      prompt_tokens: 12,
      completion_tokens: 4,
      total_tokens: 16,
    });
  });

  it("leaves a top-level usage chunk unchanged", async () => {
    const response = new Response(
      'data: {"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}\n\n',
      { headers: { "Content-Type": "text/event-stream" } },
    );

    const expected = await response.clone().text();
    const normalized = normalizeProviderUsageResponse(response);
    assert.equal(await normalized.text(), expected);
  });
});
