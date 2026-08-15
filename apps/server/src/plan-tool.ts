import { tool } from "ai";
import { z } from "zod";
import type { EventHub } from "./events.ts";
import type { PlanStore } from "./plan-store.ts";
import type { SessionStore } from "./store.ts";

export function createPlanWriteTool(
  store: PlanStore,
  events: EventHub,
  sessions: SessionStore,
  sessionId: string,
  planId: string,
) {
  return tool({
    description:
      "更新当前会话的计划 Markdown 文件。每次调用都必须传入完整计划内容，不要修改 workspace 中的任何代码文件。",
    inputSchema: z.object({
      content: z.string().max(500_000).describe("完整的计划 Markdown 文档"),
    }),
    execute: async ({ content }) => {
      const plan = await store.write(sessionId, planId, content);
      const session = await sessions.get(sessionId);
      if (session) {
        await sessions.save({
          ...session,
          plans: (session.plans ?? []).map((item) =>
            item.id === plan.id
              ? { ...item, fileName: plan.fileName, updatedAt: plan.updatedAt }
              : item,
          ),
        });
      }
      events.publish({
        type: "plan.updated",
        sessionId,
        planId: plan.id,
        planFileName: plan.fileName,
        planContent: plan.content,
        planUpdatedAt: plan.updatedAt,
      });
      return {
        id: plan.id,
        fileName: plan.fileName,
        updatedAt: plan.updatedAt,
        characters: plan.content.length,
      };
    },
  });
}
