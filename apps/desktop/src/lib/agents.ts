import type { AgentConfig, ChatToolPackId } from "@chatdesk/shared";
import { loadChatServerConfig, saveChatServerConfig } from "@/lib/chat-server";

export type { AgentConfig } from "@chatdesk/shared";

export const emptyAgent = (): AgentConfig => ({
  id: crypto.randomUUID(),
  name: "",
  avatar: "",
  modelId: "",
  systemPrompt: "",
  toolPackIds: [],
  mcpServerIds: [],
  skillIds: [],
  createdAt: "",
  updatedAt: "",
});

export async function loadAgents(): Promise<AgentConfig[]> {
  const config = await loadChatServerConfig();
  return Array.isArray(config.agents) ? config.agents : [];
}

export async function saveAgents(agents: AgentConfig[]) {
  return saveChatServerConfig({ agents });
}

export function sortAgents(agents: readonly AgentConfig[]) {
  return [...agents].sort((a, b) => {
    const time = (Date.parse(b.updatedAt) || 0) - (Date.parse(a.updatedAt) || 0);
    return time || a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });
}

export function prepareAgent(agent: AgentConfig, existing: boolean) {
  const now = new Date().toISOString();
  return {
    ...agent,
    id: agent.id || crypto.randomUUID(),
    name: agent.name.trim(),
    avatar: agent.avatar.trim().slice(0, 16),
    modelId: agent.modelId.trim(),
    systemPrompt: agent.systemPrompt.trim(),
    toolPackIds: [...new Set(agent.toolPackIds)] as ChatToolPackId[],
    mcpServerIds: [...new Set(agent.mcpServerIds)],
    skillIds: [...new Set(agent.skillIds)],
    createdAt: existing && agent.createdAt ? agent.createdAt : now,
    updatedAt: now,
  };
}
