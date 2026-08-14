import { TODO_STATUSES, type TodoItem } from "@chatdesk/shared";
import { tool } from "ai";
import { z } from "zod";

export const TODO_TOOL_INSTRUCTIONS = [
  "任务规划规则：遇到可拆分为 3 个及以上非平凡步骤的任务（多文件修改、重构、调试流程、部署步骤等）时，先调用 todo_write 建立步骤清单，再开始执行。",
  "更新节奏：开始某一步时把该条标记为 in_progress（全程最多一条 in_progress）；做完一步立即调用 todo_write 将其更新为 completed，并把下一条置为 in_progress。",
  "每完成一条必须立即单独调用一次更新，不要把多步进度合并成一次更新，也不要只在任务收尾时才更新。",
  "不要为单步即可完成、纯问答或只需一次工具调用的简单任务使用 todo_write。",
].join("\n");

const todoItemSchema = z.object({
  content: z.string().min(1).max(200).describe("步骤的简短描述"),
  status: z.enum(TODO_STATUSES).describe("步骤状态"),
  activeForm: z
    .string()
    .max(100)
    .optional()
    .describe("步骤进行中时的现在进行时描述，例如“正在修改配置文件”"),
});

export function createTodoTool() {
  return tool({
    description: [
      "维护当前任务的 todo 步骤清单（全量替换：每次调用都传入完整列表）。",
      "使用时机：任务可拆分为 3 个及以上非平凡步骤时先建立清单；单步或纯问答任务不要使用。",
      "更新节奏：开始某一步时将其标记为 in_progress（全程最多一条）；做完一步立即更新为 completed，并把下一条置为 in_progress。",
      "每完成一条必须立即单独更新一次，不得把多步进度合并成一次更新。",
    ].join(""),
    inputSchema: z.object({
      todos: z.array(todoItemSchema).min(1).max(30).describe("完整的 todo 步骤列表"),
    }),
    execute: async ({ todos }) => {
      const inProgressCount = todos.filter((item) => item.status === "in_progress").length;
      if (inProgressCount > 1) {
        throw new Error("todo 列表中最多只能有一条 in_progress，请修正后重新提交完整列表");
      }
      const completed = todos.filter((item) => item.status === "completed").length;
      const pending = todos.filter((item) => item.status === "pending").length;
      const allDone = completed === todos.length;
      return {
        total: todos.length,
        completed,
        inProgress: inProgressCount,
        pending,
        ...(allDone && todos.length >= 3
          ? {
              note: "所有步骤已完成。收尾前请确认已运行必要的验证（测试、构建、格式化等）；若尚未验证，先补验证再总结。",
            }
          : {}),
      };
    },
  });
}

export type TodoToolInput = { todos: TodoItem[] };
