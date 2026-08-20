import { describe, expect, it } from "vitest";
import { applyMentionSelection, findActiveMentionTrigger } from "./chat-composer-mentions.ts";

describe("composer mentions", () => {
  it("finds mentions at the start or after whitespace", () => {
    expect(findActiveMentionTrigger("@src/ma", 7)).toEqual({ start: 0, query: "src/ma" });
    expect(findActiveMentionTrigger("review @src/ma", 14)).toEqual({ start: 7, query: "src/ma" });
    expect(findActiveMentionTrigger("email me@example.com", 20)).toBeNull();
    expect(findActiveMentionTrigger("foo@bar", 7)).toBeNull();
  });

  it("replaces only the active token and appends the right suffix", () => {
    expect(applyMentionSelection("review @src/ma later", 14, "src/main.ts", "file")).toEqual({
      text: "review @src/main.ts  later",
      caret: 20,
      keepOpen: false,
    });
    expect(applyMentionSelection("@src", 4, "src", "dir")).toEqual({
      text: "@src/",
      caret: 5,
      keepOpen: true,
    });
  });
});
