import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentConfig } from "@chatdesk/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AutomationStore, type AutomationTask } from "./automation-store.ts";
import { createChannelAutomationTools } from "./automation-tools.ts";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true })));
});

function task(overrides: Partial<AutomationTask> = {}): AutomationTask {
  return {
    id: "task-1",
    name: "日报",
    description: "生成日报",
    scheduleMode: "interval",
    intervalMinutes: 1_440,
    startAt: "2026-08-30T09:00:00.000+08:00",
    agentId: "agent-1",
    notificationChannelId: "channel-1",
    notificationContactId: "contact-1",
    enabled: true,
    createdAt: "2026-08-29T00:00:00.000Z",
    updatedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

async function setup(userText = "查看我的自动化") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "chatdesk-channel-automation-"));
  directories.push(directory);
  const store = new AutomationStore(directory);
  await store.init();
  let syncs = 0;
  const tools = createChannelAutomationTools({
    store,
    channelId: "channel-1",
    contactId: "contact-1",
    defaultAgentId: "agent-1",
    getAgent: (id) =>
      id === "agent-1" || id === "agent-2" ? ({ id, name: id } as AgentConfig) : undefined,
    sync: () => {
      syncs += 1;
    },
    userText,
  });
  return { store, tools, getSyncs: () => syncs };
}

describe("channel automation tools", () => {
  it("restricts reads to the current contact and creates scoped tasks", async () => {
    const { store, tools } = await setup();
    await store.replace([task(), task({ id: "other", notificationContactId: "contact-2" })]);

    const listed = await tools.list_automations.execute?.({}, {} as never);
    expect(listed).toMatchObject({ tasks: [{ id: "task-1" }] });

    const created = await tools.create_automation.execute?.(
      {
        name: "提醒",
        description: "发送提醒",
        scheduleMode: "once",
        startAt: "2026-08-31T10:00:00+08:00",
      },
      {} as never,
    );
    expect(created).toMatchObject({
      task: { agentId: "agent-1", notificationContactId: "contact-1" },
    });
  });

  it("updates task fields without allowing notification reassignment", async () => {
    const { store, tools, getSyncs } = await setup();
    await store.replace([task()]);
    const updated = await tools.update_automation.execute?.(
      { taskId: "task-1", name: "新的日报", enabled: false },
      {} as never,
    );
    expect(updated).toMatchObject({ task: { name: "新的日报", enabled: false } });
    expect(store.get("task-1")).toMatchObject({
      notificationChannelId: "channel-1",
      notificationContactId: "contact-1",
    });
    expect(getSyncs()).toBe(1);
  });

  it("requires explicit deletion intent and rejects other contacts", async () => {
    const first = await setup();
    await first.store.replace([task()]);
    const refused = await first.tools.delete_automation.execute?.(
      { taskId: "task-1" },
      {} as never,
    );
    expect(refused).toMatchObject({ error: expect.stringContaining("明确") });
    expect(first.store.get("task-1")).toBeDefined();

    const second = await setup("请删除日报");
    await second.store.replace([task(), task({ id: "other", notificationContactId: "contact-2" })]);
    const removed = await second.tools.delete_automation.execute?.(
      { taskId: "task-1" },
      {} as never,
    );
    expect(removed).toEqual({ deleted: true, taskId: "task-1" });
    const denied = await second.tools.delete_automation.execute?.({ taskId: "other" }, {} as never);
    expect(denied).toMatchObject({ error: expect.stringContaining("不属于") });
  });
});
