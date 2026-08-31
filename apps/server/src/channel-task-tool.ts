import {
  type CreateTaskTargetInput,
  type CreateTaskTargetResolution,
  type CreateTaskToolContext,
  createTaskTool,
} from "@chatdesk/agent-core";
import {
  type AgentConfig,
  CREATE_TASK_RESULT_MAX_CHARS,
  CREATE_TASK_TOOL_NAME,
  DEFAULT_WORKSPACE_ID,
  type RunStartInput,
} from "@chatdesk/shared";
import type { ToolSet } from "ai";

export const CHANNEL_TASK_SYSTEM_INSTRUCTIONS = [
  "Channel 任务规则：普通问答直接回复，不要为了闲聊或简单解释创建 task。",
  "当请求需要独立执行、特定 Workspace 或其他 Agent 的专长时，按需调用 create_task；互不依赖的任务应在同一轮并行发起。",
  "create_task 的 agentId 和 workspaceId 都可以省略：省略 Agent 时沿用当前 Channel Agent，省略 Workspace 时使用该 task 自己的 Default Workspace 隔离目录。",
  "必须等待所有 task 返回后再回复联系人，并根据 status、outcome、result 和 error 总结关键产出、验证结果、失败或阻塞项；不要直接转发内部过程或假设失败任务已经完成。",
].join("\n");

export type ChannelTaskWorkspace = {
  id: string;
  name: string;
  path: string;
};

type ChannelTaskTargets = {
  defaultAgentId: string;
  getAgent: (id: string) => AgentConfig | undefined;
  listAgents: () => readonly AgentConfig[];
  getWorkspace: (id: string) => ChannelTaskWorkspace | undefined;
  listWorkspaces: () => readonly ChannelTaskWorkspace[];
};

export type ChannelTaskToolContext = Pick<
  CreateTaskToolContext,
  "store" | "events" | "runner" | "parentSessionId" | "parentInput"
> &
  ChannelTaskTargets;

function compactDescription(value: string, maxChars: number) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (!compact || compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

export function describeChannelTaskTargets(context: ChannelTaskTargets) {
  const agents = context.listAgents().map((agent) => {
    const responsibility = compactDescription(agent.systemPrompt, 160) || "未提供职责说明";
    const tools = agent.toolPackIds.length > 0 ? agent.toolPackIds.join(", ") : "无额外工具包";
    return `- ${agent.name} [${agent.id}]：${responsibility}；工具：${tools}`;
  });
  const workspaces = context
    .listWorkspaces()
    .map((workspace) => `- ${workspace.name} [${workspace.id}]：${workspace.path}`);
  return [
    "可按任务需要选择以下执行目标。Agent：",
    ...(agents.length > 0 ? agents : ["- 无可用 Agent"]),
    "Workspace：",
    ...(workspaces.length > 0 ? workspaces : ["- 无可用 Workspace"]),
  ].join("\n");
}

export function resolveChannelTaskTarget(
  context: ChannelTaskTargets,
  input: CreateTaskTargetInput,
): CreateTaskTargetResolution {
  const requestedAgentId = input.agentId?.trim();
  const agentId = requestedAgentId || context.defaultAgentId;
  const agent = context.getAgent(agentId);
  if (!agent) {
    throw new Error(
      requestedAgentId
        ? `任务 Agent 不存在或已失效：${agentId}`
        : "Channel 主 Agent 不存在或已失效",
    );
  }

  const workspaceId = input.workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
  const workspace = context.getWorkspace(workspaceId);
  if (!workspace) throw new Error(`任务 Workspace 不存在或已失效：${workspaceId}`);

  return {
    agentId: agent.id,
    runInput: {
      agentId: agent.id,
      model: undefined,
      modelId: agent.modelId,
      system: agent.systemPrompt || undefined,
      mcpServerIds: agent.mcpServerIds,
      skillIds: agent.skillIds,
      toolNames: agent.toolPackIds,
      workspaceId: workspace.id,
      cwd: undefined,
    } satisfies Partial<RunStartInput>,
  };
}

export function createChannelTaskTools(context: ChannelTaskToolContext): ToolSet {
  return {
    [CREATE_TASK_TOOL_NAME]: createTaskTool({
      store: context.store,
      events: context.events,
      runner: context.runner,
      parentSessionId: context.parentSessionId,
      parentInput: context.parentInput,
      targeting: {
        description: `\n${describeChannelTaskTargets(context)}`,
        resolve: (input) => resolveChannelTaskTarget(context, input),
      },
      resultMaxChars: CREATE_TASK_RESULT_MAX_CHARS,
    }),
  };
}
