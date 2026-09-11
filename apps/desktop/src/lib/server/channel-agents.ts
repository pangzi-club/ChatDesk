import type { AgentConfig, FeishuChannelStatus, ModelConfig } from "@chatdesk/shared";

export function resolveChannelAgent(
  channelId: string,
  statuses: readonly FeishuChannelStatus[],
  agents: readonly AgentConfig[],
  models: readonly ModelConfig[],
) {
  const status = statuses.find((item) => item.channelId === channelId);
  const agent = status?.agentId ? agents.find((item) => item.id === status.agentId) : undefined;
  const model = agent ? models.find((item) => item.id === agent.modelId) : undefined;
  return { status, agent, model };
}
