import { describe, expect, it } from "vitest";
import { resolveComposerEnterAction } from "./chat-composer-submit.ts";

describe("resolveComposerEnterAction", () => {
  it("submits normally when the agent is idle", () => {
    expect(resolveComposerEnterAction({ isGenerating: false, metaKey: false })).toBe("submit");
    expect(resolveComposerEnterAction({ isGenerating: false, metaKey: true })).toBe("submit");
  });

  it("queues Enter while the agent is running", () => {
    expect(resolveComposerEnterAction({ isGenerating: true, metaKey: false })).toBe("queue");
  });

  it("sends a follow-up for Command+Enter while the agent is running", () => {
    expect(resolveComposerEnterAction({ isGenerating: true, metaKey: true })).toBe("follow-up");
  });
});
