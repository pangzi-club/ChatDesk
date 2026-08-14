import type { UIMessage } from "ai";
import { describe, expect, it } from "vitest";
import { getLatestTodoState } from "./chat-todo-panel";

function todoMessage(
  id: string,
  parts: Array<{
    state: string;
    input?: unknown;
    type?: string;
  }>,
): UIMessage {
  return {
    id,
    role: "assistant",
    parts: parts.map((part, index) => ({
      type: part.type ?? "tool-todo_write",
      toolCallId: `${id}-${index}`,
      state: part.state,
      ...(part.input !== undefined ? { input: part.input } : {}),
    })),
  } as UIMessage;
}

const initialTodos = {
  todos: [
    { content: "分析现有代码", status: "pending" },
    { content: "实现核心逻辑", status: "pending" },
    { content: "补充测试", status: "pending" },
  ],
};

const progressedTodos = {
  todos: [
    { content: "分析现有代码", status: "completed" },
    { content: "实现核心逻辑", status: "in_progress", activeForm: "正在实现核心逻辑" },
    { content: "补充测试", status: "pending" },
  ],
};

describe("getLatestTodoState", () => {
  it("returns null when messages contain no todo_write calls", () => {
    expect(getLatestTodoState([])).toBeNull();
    expect(
      getLatestTodoState([
        todoMessage("m1", [
          { state: "output-available", type: "tool-read_file", input: { path: "a" } },
        ]),
      ]),
    ).toBeNull();
  });

  it("picks the latest valid todo_write call across messages", () => {
    const state = getLatestTodoState([
      todoMessage("m1", [{ state: "output-available", input: initialTodos }]),
      todoMessage("m2", [{ state: "output-available", input: progressedTodos }]),
    ]);

    expect(state).not.toBeNull();
    expect(state?.total).toBe(3);
    expect(state?.completed).toBe(1);
    expect(state?.current?.content).toBe("实现核心逻辑");
  });

  it("ignores failed or malformed todo_write calls", () => {
    const state = getLatestTodoState([
      todoMessage("m1", [{ state: "output-available", input: initialTodos }]),
      todoMessage("m2", [
        { state: "output-error", input: progressedTodos },
        { state: "output-available", input: { todos: [] } },
      ]),
    ]);

    expect(state?.completed).toBe(0);
    expect(state?.current?.content).toBe("分析现有代码");
  });

  it("falls back to the first pending item when nothing is in progress", () => {
    const state = getLatestTodoState([
      todoMessage("m1", [{ state: "input-available", input: initialTodos }]),
    ]);

    expect(state?.current?.content).toBe("分析现有代码");
    expect(state?.current?.status).toBe("pending");
  });

  it("ignores streaming calls whose partial input prefix already looks valid", () => {
    const state = getLatestTodoState([
      todoMessage("m1", [{ state: "output-available", input: initialTodos }]),
      todoMessage("m2", [
        {
          state: "input-streaming",
          input: { todos: [{ content: "第一步", status: "pending" }] },
        },
      ]),
    ]);

    expect(state?.total).toBe(3);
    expect(state?.completed).toBe(0);
  });

  it("returns null when only a streaming call exists", () => {
    expect(
      getLatestTodoState([
        todoMessage("m1", [
          {
            state: "input-streaming",
            input: { todos: [{ content: "第一步", status: "pending" }] },
          },
        ]),
      ]),
    ).toBeNull();
  });
});
