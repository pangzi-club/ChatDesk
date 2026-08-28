import type { AgentConfig } from "@chatdesk/shared";
import { describe, expect, it } from "vitest";
import { getAgentAvatarHoverCardState } from "./agent-avatar-hover-card";

const agent: AgentConfig = {
  id: "agent-one",
  name: "Agent One",
  avatar: "",
  modelId: "model-one",
  systemPrompt: "Prompt",
  toolPackIds: [],
  mcpServerIds: [],
  skillIds: [],
  createdAt: "2026-08-28T00:00:00.000Z",
  updatedAt: "2026-08-28T00:00:00.000Z",
};

describe("getAgentAvatarHoverCardState", () => {
  it("allows navigation only for a loaded agent", () => {
    expect(getAgentAvatarHoverCardState({ agent })).toEqual({
      name: "Agent One",
      description: "",
      canNavigate: true,
    });
  });

  it("distinguishes loading, unavailable, and unbound states", () => {
    expect(getAgentAvatarHoverCardState({ loading: true })).toMatchObject({
      description: "正在加载 Agent 信息",
      canNavigate: false,
    });
    expect(
      getAgentAvatarHoverCardState({ agentId: "missing", fallbackName: "Configured Agent" }),
    ).toEqual({
      name: "Configured Agent",
      description: "Agent 配置暂不可用",
      canNavigate: false,
    });
    expect(getAgentAvatarHoverCardState({})).toEqual({
      name: "未绑定 Agent",
      description: "当前 Channel 未绑定有效 Agent",
      canNavigate: false,
    });
  });
});
