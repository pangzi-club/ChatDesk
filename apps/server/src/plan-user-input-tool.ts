import { tool } from "ai";
import { z } from "zod";

const optionSchema = z.object({
  id: z.string().trim().min(1).max(64).describe("选项稳定 ID"),
  label: z.string().trim().min(1).max(120).describe("选项标签"),
  description: z.string().trim().min(1).max(240).optional().describe("选项影响或取舍"),
});

const questionSchema = z
  .object({
    id: z.string().trim().min(1).max(64).describe("问题稳定 ID"),
    header: z.string().trim().min(1).max(32).describe("简短分组标题"),
    question: z.string().trim().min(1).max(500).describe("需要用户回答的问题"),
    options: z.array(optionSchema).min(2).max(4).describe("互斥的预设选项"),
    recommendedOptionId: z.string().trim().min(1).max(64).describe("推荐选项 ID"),
  })
  .superRefine((question, context) => {
    const optionIds = question.options.map((option) => option.id);
    if (new Set(optionIds).size !== optionIds.length) {
      context.addIssue({ code: "custom", message: "同一问题的选项 ID 必须唯一" });
    }
    if (!optionIds.includes(question.recommendedOptionId)) {
      context.addIssue({ code: "custom", message: "recommendedOptionId 必须指向已有选项" });
    }
  });

export const PLAN_USER_INPUT_INSTRUCTIONS = [
  "需要用户决定会改变计划的产品意图或实现取舍时，必须调用 request_user_input；不要把问题作为普通文本回复。",
  "一次调用集中提交当前全部阻塞问题，每次 1 到 3 题；每题提供 2 到 4 个互斥选项，并明确一个推荐项。",
  "问题和选项应具体、简短、可直接决策；不要询问能通过只读调研确认的事实。客户端会自动在每题末尾提供自定义输入。",
  "调用 request_user_input 后立即等待用户回答，不要在同一步调用 plan_write，也不要声称计划已完成。",
].join("\n");

export function createPlanUserInputTool() {
  return tool({
    description:
      "向用户提交一组完成计划所必需的单选问题。客户端会展示推荐选项、其他选项和自定义输入，并将整组答案作为 tool output 返回。",
    inputSchema: z.object({
      questions: z
        .array(questionSchema)
        .min(1)
        .max(3)
        .superRefine((questions, context) => {
          const questionIds = questions.map((question) => question.id);
          if (new Set(questionIds).size !== questionIds.length) {
            context.addIssue({ code: "custom", message: "问题 ID 必须唯一" });
          }
        }),
    }),
  });
}
