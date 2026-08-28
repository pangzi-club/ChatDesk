import type { AgentConfig, ModelConfig } from "@chatdesk/shared";
import { Bot, ExternalLink } from "lucide-react";
import { type MouseEvent, type ReactNode, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { AgentAvatar } from "@/components/agent-avatar";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";

type AgentAvatarHoverCardProps = {
  agent?: AgentConfig;
  agentId?: string;
  model?: ModelConfig;
  fallbackName?: string;
  fallbackAvatar?: string;
  loading?: boolean;
  avatarClassName?: string;
  avatarFallback?: ReactNode;
  children?: ReactNode;
};

export function AgentAvatarHoverCard({
  agent,
  agentId,
  model,
  fallbackName,
  fallbackAvatar,
  loading = false,
  avatarClassName = "size-8",
  avatarFallback,
  children,
}: AgentAvatarHoverCardProps) {
  const navigate = useNavigate();
  const state = getAgentAvatarHoverCardState({ agent, agentId, fallbackName, loading });

  const openAgentPage = useCallback(() => {
    if (state.canNavigate) navigate("/settings/agents");
  }, [navigate, state.canNavigate]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    event.stopPropagation();
    openAgentPage();
  }

  return (
    <HoverCard closeDelay={120} openDelay={260}>
      <HoverCardTrigger asChild>
        <a
          aria-label={state.canNavigate ? `查看 Agent ${state.name}` : state.name}
          aria-disabled={state.canNavigate ? undefined : true}
          className={`inline-flex rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${state.canNavigate ? "cursor-pointer" : "cursor-default"}`}
          href="/settings/agents"
          onClick={handleClick}
        >
          {children || (
            <AgentAvatar
              aria-hidden="true"
              className={avatarClassName}
              fallback={avatarFallback}
              value={agent?.avatar || fallbackAvatar}
            />
          )}
        </a>
      </HoverCardTrigger>
      <HoverCardContent className="w-80 p-3" side="right" sideOffset={8}>
        <div className="flex items-start gap-3">
          <AgentAvatar className="size-10 shrink-0" value={agent?.avatar || fallbackAvatar} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate font-medium text-sm">{state.name}</p>
              {state.canNavigate ? (
                <ExternalLink className="size-3.5 shrink-0 text-muted-foreground" />
              ) : null}
            </div>
            {agent ? (
              <>
                <p className="mt-1 truncate text-muted-foreground text-xs">
                  {model?.name || agent.modelId || "模型未配置"}
                </p>
                <p className="mt-2 line-clamp-2 text-muted-foreground text-xs">
                  {agent.systemPrompt || "未设置系统提示词"}
                </p>
                <p className="mt-2 text-muted-foreground text-[11px]">
                  Tools {agent.toolPackIds.length} · MCP {agent.mcpServerIds.length} · Skills{" "}
                  {agent.skillIds.length}
                </p>
              </>
            ) : (
              <p className="mt-1 text-muted-foreground text-xs">{state.description}</p>
            )}
          </div>
        </div>
        {state.canNavigate ? (
          <button
            className="mt-3 flex items-center gap-1 text-muted-foreground text-[11px] underline-offset-2 hover:text-foreground hover:underline"
            onClick={(event) => {
              event.stopPropagation();
              openAgentPage();
            }}
            type="button"
          >
            <Bot className="size-3" /> 点击查看 Agent 配置
          </button>
        ) : null}
      </HoverCardContent>
    </HoverCard>
  );
}

export function getAgentAvatarHoverCardState({
  agent,
  agentId,
  fallbackName,
  loading,
}: Pick<AgentAvatarHoverCardProps, "agent" | "agentId" | "fallbackName" | "loading">) {
  if (agent) {
    return { name: agent.name, description: "", canNavigate: true };
  }
  if (loading) {
    return {
      name: fallbackName || "正在加载 Agent",
      description: "正在加载 Agent 信息",
      canNavigate: false,
    };
  }
  if (agentId) {
    return {
      name: fallbackName || "绑定 Agent",
      description: "Agent 配置暂不可用",
      canNavigate: false,
    };
  }
  return {
    name: "未绑定 Agent",
    description: "当前 Channel 未绑定有效 Agent",
    canNavigate: false,
  };
}
