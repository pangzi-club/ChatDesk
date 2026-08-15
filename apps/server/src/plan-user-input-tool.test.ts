import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { createPlanUserInputTool } from "./plan-user-input-tool.ts";

describe("request_user_input tool", () => {
  const validQuestion = {
    id: "placement",
    header: "按钮位置",
    question: "按钮放在哪里？",
    recommendedOptionId: "composer",
    options: [
      { id: "composer", label: "Composer", description: "保持操作集中" },
      { id: "message", label: "消息底部" },
    ],
  };

  it("is a client tool with a bounded question schema", () => {
    const tool = createPlanUserInputTool();
    const schema = tool.inputSchema as z.ZodType;
    expect(tool.execute).toBeUndefined();
    expect(schema.parse({ questions: [validQuestion] })).toEqual({ questions: [validQuestion] });
    expect(() => schema.parse({ questions: [] })).toThrow();
    expect(() =>
      schema.parse({ questions: Array.from({ length: 4 }, () => validQuestion) }),
    ).toThrow();
  });

  it("rejects duplicate IDs and missing recommended options", () => {
    const schema = createPlanUserInputTool().inputSchema as z.ZodType;
    expect(() =>
      schema.parse({
        questions: [
          {
            ...validQuestion,
            options: [
              { id: "same", label: "A" },
              { id: "same", label: "B" },
            ],
            recommendedOptionId: "same",
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      schema.parse({ questions: [{ ...validQuestion, recommendedOptionId: "missing" }] }),
    ).toThrow();
  });
});
