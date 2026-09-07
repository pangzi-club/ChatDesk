import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import {
  appendSkillSuggestion,
  countConversationToolCalls,
  hasSkillSuggestion,
  SKILL_SUGGESTION_TEXT,
  skillSuggestionInstructions,
} from "./skill-suggestion.ts";

function answer(id: string, count?: number, calls: string[] = []): UIMessage {
  return {
    id,
    role: "assistant",
    parts: [
      ...calls.map((toolCallId) => ({
        type: "dynamic-tool" as const,
        toolName: "read_file",
        toolCallId,
        state: "output-error" as const,
        input: {},
        errorText: "failed",
      })),
      { type: "text", text: "Done." },
    ],
    metadata: count === undefined ? {} : { runSummary: { runId: id, toolCallCount: count } },
  };
}

describe("skill suggestion", () => {
  it("requires more than ten calls accumulated across runs", () => {
    const ten = [answer("one", 6), answer("two", 4)];
    expect(appendSkillSuggestion(ten, "completed")).toBe(ten);
    const eleven = [...ten, answer("three", 1)];
    const result = appendSkillSuggestion(eleven, "completed");
    expect(result.at(-1)?.parts.at(-1)).toEqual({
      type: "text",
      text: `\n\n${SKILL_SUGGESTION_TEXT}`,
    });
    expect(result.at(-1)?.metadata).toMatchObject({
      skillSuggestion: true,
      runSummary: { runId: "three", toolCallCount: 1 },
    });
    expect(eleven.at(-1)?.parts).toHaveLength(1);
  });

  it("deduplicates summaries and legacy calls, including failed tools", () => {
    const messages = [
      answer("legacy", undefined, ["old", "old", "covered"]),
      answer("run", 6, ["covered"]),
      answer("run", 7, ["covered"]),
      answer("other", 2),
    ];
    expect(countConversationToolCalls(messages)).toBe(10);
    expect(countConversationToolCalls([answer("invalid", NaN, ["call"])])).toBe(1);
  });

  it.each(["error", "stopped", "awaiting-user"] as const)("does not append on %s", (outcome) => {
    const messages = [answer("run", 11)];
    expect(appendSkillSuggestion(messages, outcome)).toBe(messages);
  });

  it("requires a final assistant answer", () => {
    const messages = [answer("run", 11)];
    messages[0].parts = [];
    expect(appendSkillSuggestion(messages, "completed")).toBe(messages);
  });

  it("persists the marker and never repeats after subsequent replies", () => {
    const first = appendSkillSuggestion([answer("run", 11)], "completed");
    const restored = JSON.parse(JSON.stringify(first)) as UIMessage[];
    for (const text of ["可以", "好的", "不用", "换个话题"]) {
      const messages: UIMessage[] = [
        ...restored,
        { id: "reply", role: "user", parts: [{ type: "text", text }] },
        answer("next", 15),
      ];
      expect(hasSkillSuggestion(messages)).toBe(true);
      expect(appendSkillSuggestion(messages, "completed")).toBe(messages);
    }
  });

  it("provides contextual confirmation instructions only after a suggestion", () => {
    expect(skillSuggestionInstructions([answer("run", 11)])).toBe("");
    const instructions = skillSuggestionInstructions(
      appendSkillSuggestion([answer("run", 11)], "completed"),
    );
    expect(instructions).toContain("builtin:skill-creator");
    expect(instructions).toContain("用户拒绝、另起话题或意图不明确时，不要自行创建");
    expect(instructions).toContain("遵守当前计划模式和文件写入权限");
  });
});
