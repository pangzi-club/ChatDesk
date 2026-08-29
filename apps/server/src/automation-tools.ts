import { randomUUID } from "node:crypto";
import type { AgentConfig } from "@chatdesk/shared";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { AutomationStore, AutomationTask } from "./automation-store.ts";

type ChannelAutomationContext = {
  store: AutomationStore;
  channelId: string;
  contactId: string;
  defaultAgentId: string;
  getAgent: (id: string) => AgentConfig | undefined;
  sync: () => void;
  userText: string;
};

const scheduleMode = z.enum(["once", "interval"]);
const id = z.string().trim().min(1).max(128);
const isoDate = z
  .string()
  .trim()
  .refine((value) => !Number.isNaN(Date.parse(value)), "startAt 必须是有效的 ISO 8601 时间");

function scoped(task: AutomationTask, context: ChannelAutomationContext) {
  return (
    task.notificationChannelId === context.channelId &&
    task.notificationContactId === context.contactId
  );
}

function visibleTask(task: AutomationTask, context: ChannelAutomationContext) {
  return {
    ...task,
    agentName: context.getAgent(task.agentId)?.name,
  };
}

async function safe<T>(operation: () => Promise<T>): Promise<T | { error: string }> {
  try {
    return await operation();
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function deletionWasExplicit(text: string) {
  return /删除|删掉|移除/.test(text);
}

export function createChannelAutomationTools(context: ChannelAutomationContext): ToolSet {
  const findVisible = (taskId: string) => {
    const task = context.store.get(taskId);
    return task && scoped(task, context) ? task : undefined;
  };

  return {
    list_automations: tool({
      description: "列出当前飞书联系人可管理的 automation 任务。只能看到通知发送到当前会话的任务。",
      inputSchema: z.object({ includeDisabled: z.boolean().optional() }),
      execute: async ({ includeDisabled = true }) => {
        const tasks = context.store
          .list()
          .filter((task) => scoped(task, context) && (includeDisabled || task.enabled))
          .map((task) => visibleTask(task, context));
        return { tasks };
      },
    }),
    get_automation: tool({
      description: "读取一个当前飞书联系人可管理的 automation 及其最近执行记录。",
      inputSchema: z.object({ taskId: id }),
      execute: async ({ taskId }) => {
        const task = findVisible(taskId);
        if (!task) return { error: "Automation 任务不存在或不属于当前联系人" };
        return {
          task: visibleTask(task, context),
          runs: context.store.listRuns(task.id).slice(0, 20),
        };
      },
    }),
    create_automation: tool({
      description:
        "为当前飞书联系人创建 automation。startAt 必须使用带时区的 ISO 8601 时间；新任务默认使用当前 Channel 绑定的 Agent，并把执行结果发送回当前会话。",
      inputSchema: z.object({
        name: z.string().trim().min(1).max(120),
        description: z.string().trim().min(1).max(20_000),
        scheduleMode,
        startAt: isoDate,
        intervalMinutes: z.number().int().positive().optional(),
        agentId: id.optional(),
        enabled: z.boolean().optional(),
      }),
      execute: async (input) =>
        safe(async () => {
          if (input.scheduleMode === "interval" && !input.intervalMinutes) {
            throw new Error("interval 模式必须提供正整数 intervalMinutes");
          }
          const agentId = input.agentId ?? context.defaultAgentId;
          if (!context.getAgent(agentId)) throw new Error("Automation 任务绑定的 Agent 不存在");
          const now = new Date().toISOString();
          const task: AutomationTask = {
            id: randomUUID(),
            name: input.name,
            description: input.description,
            scheduleMode: input.scheduleMode,
            intervalMinutes: input.intervalMinutes ?? 1,
            startAt: new Date(input.startAt).toISOString(),
            agentId,
            notificationChannelId: context.channelId,
            notificationContactId: context.contactId,
            enabled: input.enabled ?? true,
            createdAt: now,
            updatedAt: now,
          };
          const saved = await context.store.createTask(task);
          context.sync();
          return { task: visibleTask(saved, context) };
        }),
    }),
    update_automation: tool({
      description:
        "修改当前飞书联系人的 automation。不能修改任务 ID、创建时间或通知归属；未提供的字段保持不变。",
      inputSchema: z.object({
        taskId: id,
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().min(1).max(20_000).optional(),
        scheduleMode: scheduleMode.optional(),
        startAt: isoDate.optional(),
        intervalMinutes: z.number().int().positive().optional(),
        agentId: id.optional(),
        enabled: z.boolean().optional(),
      }),
      execute: async ({ taskId, ...patch }) =>
        safe(async () => {
          const existing = findVisible(taskId);
          if (!existing) throw new Error("Automation 任务不存在或不属于当前联系人");
          const nextMode = patch.scheduleMode ?? existing.scheduleMode;
          if (nextMode === "interval" && !(patch.intervalMinutes ?? existing.intervalMinutes)) {
            throw new Error("interval 模式必须提供正整数 intervalMinutes");
          }
          if (patch.agentId && !context.getAgent(patch.agentId)) {
            throw new Error("Automation 任务绑定的 Agent 不存在");
          }
          const updated = await context.store.updateTask(taskId, {
            ...patch,
            ...(patch.startAt ? { startAt: new Date(patch.startAt).toISOString() } : {}),
          });
          if (!updated) throw new Error("Automation 任务不存在");
          context.sync();
          return { task: visibleTask(updated, context) };
        }),
    }),
    delete_automation: tool({
      description:
        "删除当前飞书联系人的 automation。只有用户在当前消息中明确说删除、删掉或移除时才执行。",
      inputSchema: z.object({ taskId: id }),
      execute: async ({ taskId }) =>
        safe(async () => {
          if (!deletionWasExplicit(context.userText)) {
            throw new Error("请明确说出删除、删掉或移除后再删除 Automation");
          }
          if (!findVisible(taskId)) throw new Error("Automation 任务不存在或不属于当前联系人");
          await context.store.remove(taskId);
          context.sync();
          return { deleted: true, taskId };
        }),
    }),
  };
}
