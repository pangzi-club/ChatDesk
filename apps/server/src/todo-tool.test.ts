import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { createTodoTool } from "./todo-tool.ts";

type TodoInput = {
  todos: Array<{ content: string; status: "pending" | "in_progress" | "completed" }>;
};

async function executeTodo(input: TodoInput) {
  const todoTool = createTodoTool();
  const execute = todoTool.execute;
  if (!execute) throw new Error("todo tool 缺少 execute 实现");
  return execute(
    input as never,
    {
      toolCallId: "test",
      messages: [],
      abortSignal: new AbortController().signal,
    } as never,
  );
}

describe("todo_write tool", () => {
  it("returns completion statistics for a valid list", async () => {
    const result = (await executeTodo({
      todos: [
        { content: "分析现有代码", status: "completed" },
        { content: "实现核心逻辑", status: "in_progress" },
        { content: "补充测试", status: "pending" },
      ],
    })) as { total: number; completed: number; inProgress: number; pending: number; note?: string };

    expect(result.total).toBe(3);
    expect(result.completed).toBe(1);
    expect(result.inProgress).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.note).toBeUndefined();
  });

  it("attaches a verification reminder when every step is completed", async () => {
    const result = (await executeTodo({
      todos: [
        { content: "第一步", status: "completed" },
        { content: "第二步", status: "completed" },
        { content: "第三步", status: "completed" },
      ],
    })) as { note?: string };

    expect(result.note).toContain("验证");
  });

  it("rejects lists with more than one in_progress item", async () => {
    await expect(
      executeTodo({
        todos: [
          { content: "第一步", status: "in_progress" },
          { content: "第二步", status: "in_progress" },
        ],
      }),
    ).rejects.toThrow("最多只能有一条 in_progress");
  });

  it("validates the input schema against empty or oversized lists", () => {
    const schema = createTodoTool().inputSchema as z.ZodType;
    expect(() => schema.parse({ todos: [] })).toThrow();
    expect(() =>
      schema.parse({
        todos: Array.from({ length: 31 }, (_, index) => ({
          content: `s${index}`,
          status: "pending",
        })),
      }),
    ).toThrow();
    expect(() =>
      schema.parse({ todos: [{ content: "x".repeat(201), status: "pending" }] }),
    ).toThrow();
  });
});
