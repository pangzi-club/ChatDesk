import type { AgentConfig, FeishuChannelStatus, ModelConfig } from "@chatdesk/shared";
import { describe, expect, it } from "vitest";
import { resolveChannelAgent } from "./channel-agents";

const agents: AgentConfig[] = [
  {
    id: "agent-one",
    name: "Agent One",
    avatar: "",
    modelId: "model-one",
    systemPrompt: "First prompt",
    toolPackIds: [],
    mcpServerIds: [],
    skillIds: [],
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  },
  {
    id: "agent-two",
    name: "Agent Two",
    avatar: "",
    modelId: "model-two",
    systemPrompt: "Second prompt",
    toolPackIds: [],
    mcpServerIds: [],
    skillIds: [],
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
  },
];

const statuses: FeishuChannelStatus[] = [
  {
    provider: "feishu",
    channelId: "channel-one",
    configured: true,
    status: "connected",
    agentId: "agent-one",
  },
  {
    provider: "feishu",
    channelId: "channel-two",
    configured: true,
    status: "connected",
    agentId: "agent-two",
  },
];

const models = [
  { id: "model-one", name: "Model One" },
  { id: "model-two", name: "Model Two" },
] as ModelConfig[];

describe("resolveChannelAgent", () => {
  it("resolves each channel to its own agent and model", () => {
    expect(resolveChannelAgent("channel-one", statuses, agents, models)).toMatchObject({
      agent: { id: "agent-one" },
      model: { id: "model-one" },
    });
    expect(resolveChannelAgent("channel-two", statuses, agents, models)).toMatchObject({
      agent: { id: "agent-two" },
      model: { id: "model-two" },
    });
  });

  it("keeps the channel status when its agent configuration is unavailable", () => {
    expect(resolveChannelAgent("channel-one", statuses, [], models)).toEqual({
      status: statuses[0],
      agent: undefined,
      model: undefined,
    });
  });
});
