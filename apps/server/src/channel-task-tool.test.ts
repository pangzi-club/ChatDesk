import { type AgentConfig, DEFAULT_WORKSPACE_ID } from "@chatdesk/shared";
import { describe, expect, it } from "vitest";
import {
  CHANNEL_TASK_SYSTEM_INSTRUCTIONS,
  describeChannelTaskTargets,
  resolveChannelTaskTarget,
} from "./channel-task-tool.ts";

function agent(id: string, overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id,
    name: id,
    avatar: "",
    modelId: `${id}-model`,
    systemPrompt: `${id} 负责代码审查`,
    toolPackIds: ["read_file"],
    mcpServerIds: [`${id}-mcp`],
    skillIds: [`${id}-skill`],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function context() {
  const agents = [agent("main"), agent("reviewer")];
  const workspaces = [
    { id: DEFAULT_WORKSPACE_ID, name: "Default Workspace", path: "/tasks" },
    { id: "project", name: "Project", path: "/work/project" },
  ];
  return {
    defaultAgentId: "main",
    getAgent: (id: string) => agents.find((item) => item.id === id),
    listAgents: () => agents,
    getWorkspace: (id: string) => workspaces.find((item) => item.id === id),
    listWorkspaces: () => workspaces,
  };
}

describe("channel task targets", () => {
  it("requires on-demand delegation and same-run result summaries", () => {
    expect(CHANNEL_TASK_SYSTEM_INSTRUCTIONS).toContain("普通问答直接回复");
    expect(CHANNEL_TASK_SYSTEM_INSTRUCTIONS).toContain("必须等待所有 task 返回后再回复联系人");
    expect(CHANNEL_TASK_SYSTEM_INSTRUCTIONS).toContain("总结关键产出、验证结果、失败或阻塞项");
  });

  it("describes every available Agent and Workspace", () => {
    const description = describeChannelTaskTargets(context());
    expect(description).toContain("main [main]");
    expect(description).toContain("reviewer [reviewer]");
    expect(description).toContain("Project [project]：/work/project");
  });

  it("uses the selected Agent and Workspace configuration", () => {
    const target = resolveChannelTaskTarget(context(), {
      agentId: "reviewer",
      workspaceId: "project",
    });
    expect(target.agentId).toBe("reviewer");
    expect(target.runInput).toMatchObject({
      agentId: "reviewer",
      modelId: "reviewer-model",
      system: "reviewer 负责代码审查",
      mcpServerIds: ["reviewer-mcp"],
      skillIds: ["reviewer-skill"],
      toolNames: ["read_file"],
      workspaceId: "project",
    });
    expect(target.runInput.cwd).toBeUndefined();
  });

  it("inherits the Channel Agent and selects an isolated default workspace when omitted", () => {
    const target = resolveChannelTaskTarget(context(), {});
    expect(target.agentId).toBe("main");
    expect(target.runInput.workspaceId).toBe(DEFAULT_WORKSPACE_ID);
    expect(target.runInput.cwd).toBeUndefined();
  });

  it("rejects stale Agent and Workspace identifiers", () => {
    expect(() => resolveChannelTaskTarget(context(), { agentId: "removed" })).toThrow(
      "任务 Agent 不存在或已失效：removed",
    );
    expect(() => resolveChannelTaskTarget(context(), { workspaceId: "removed" })).toThrow(
      "任务 Workspace 不存在或已失效：removed",
    );
  });
});
