import type {
  ChatContributionScope,
  ChatEmptyStateProps,
  ChatGeneratingContribution,
  ChatGenerationSnapshot,
  ChatRegionContribution,
  DesktopPluginModule,
} from "@chatdesk/desktop-plugin-sdk";
import type { Context } from "cordis";
import { Bug, Hammer, RefreshCw, SearchCode } from "lucide-react";
import type { ReactNode } from "react";
import { useChatLayoutId } from "@/components/chat-layout-provider";
import type { ChatLayoutProps } from "@/lib/plugins/chat-layout";

export const manifest = {
  id: "chat-layout-standard",
  builtin: true,
  name: "标准聊天布局",
  description: "提供简洁稳定的默认 Chat 页面布局。",
  version: "1.0.0",
  apiVersion: 1,
  entry: "plugins/chat-layout-standard",
  contributes: ["chat.layout", "chat.messages.empty", "chat.generating", "chat.status"],
  permissions: [],
} as const;
export const inject: DesktopPluginModule["inject"] = ["desktopUi", "chatLayouts"];

const EMPTY_ACTIONS = [
  {
    label: "探索并理解代码",
    prompt: "请帮我探索并理解这个代码库。",
    icon: SearchCode,
    accent: "blue",
  },
  {
    label: "构建新功能",
    prompt: "请帮我构建一个新功能、应用或工具。",
    icon: Hammer,
    accent: "violet",
  },
  { label: "审查代码", prompt: "请审查这份代码并提出修改建议。", icon: RefreshCw, accent: "green" },
  { label: "修复问题", prompt: "请帮我定位并修复这个问题。", icon: Bug, accent: "orange" },
] as const;

const LAYOUT_STYLES = `
  .chat-empty-standard .chat-empty-mark {
    position: relative;
    display: grid;
    place-items: center;
  }
  .chat-standard-orb {
    width: 56px;
    height: 56px;
    border-radius: 50%;
    background: radial-gradient(
      120% 120% at 30% 30%,
      color-mix(in srgb, var(--primary) 45%, var(--card)) 0%,
      color-mix(in srgb, var(--accent) 55%, var(--card)) 100%
    );
    box-shadow: 0 12px 36px color-mix(in srgb, var(--primary) 18%, transparent);
    animation: chat-standard-pulse 4s ease-in-out infinite;
  }
  .chat-generating-standard .chat-thinking-dots {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 0;
  }
  .chat-generating-standard .chat-thinking-dots span {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--primary) 60%, var(--foreground));
    animation: chat-standard-dot 1.4s ease-in-out infinite;
  }
  .chat-generating-standard .chat-thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
  .chat-generating-standard .chat-thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
  .chat-status-standard {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: color-mix(in srgb, var(--card) 80%, transparent);
    padding: 2px 10px;
    font-size: 11px;
    color: var(--muted-foreground);
  }
  @keyframes chat-standard-pulse {
    0%, 100% { transform: scale(1); opacity: 1; }
    50% { transform: scale(1.06); opacity: 0.85; }
  }
  @keyframes chat-standard-dot {
    0%, 100% { transform: translateY(0); opacity: 0.45; }
    50% { transform: translateY(-5px); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .chat-standard-orb,
    .chat-generating-standard .chat-thinking-dots span {
      animation: none;
    }
  }
`;

function LayoutSlot({ children, layoutId }: { children: ReactNode; layoutId: string }) {
  const active = useChatLayoutId() === layoutId;
  if (!active) return null;
  return <>{children}</>;
}

function StandardEmptyState({ setInput, focus }: ChatEmptyStateProps) {
  return (
    <LayoutSlot layoutId="standard">
      <div className="chat-empty-state chat-empty-standard">
        <div aria-hidden="true" className="chat-empty-mark">
          <div className="chat-standard-orb" />
        </div>
        <h2>今天想做什么？</h2>
        <div className="chat-suggestion-grid">
          {EMPTY_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                className={`chat-suggestion-card is-${action.accent}`}
                key={action.label}
                onClick={() => {
                  setInput(action.prompt);
                  focus();
                }}
                type="button"
              >
                <Icon aria-hidden="true" className="size-[18px]" strokeWidth={1.8} />
                <span>{action.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </LayoutSlot>
  );
}

function StandardGenerating({
  generation,
}: {
  scope: ChatContributionScope;
  generation: ChatGenerationSnapshot;
}) {
  return (
    <LayoutSlot layoutId="standard">
      <div className="chat-message assistant-message chat-generating-standard">
        <div className="chat-message-body">
          <div className="chat-message-meta">
            <span>{generation.phase || "正在思考"}</span>
          </div>
          <div className="chat-thinking-dots">
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </LayoutSlot>
  );
}

function StandardStatus(_props: { scope: ChatContributionScope }) {
  return (
    <LayoutSlot layoutId="standard">
      <span className="chat-status-standard">标准布局</span>
    </LayoutSlot>
  );
}

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      (() => {
        const layoutComponent = ({ children }: ChatLayoutProps) => (
          <div className="chat-layout-root chat-layout-standard">
            <style>{LAYOUT_STYLES}</style>
            {children}
          </div>
        );
        const disposeSlot = ctx.desktopUi.register("chat.layout", {
          id: "standard",
          label: "标准",
          component: layoutComponent,
        });
        const disposeLayout = ctx.chatLayouts.register("standard", layoutComponent);
        const disposeEmpty = ctx.desktopUi.register("chat.messages.empty", {
          id: "standard.empty",
          component: StandardEmptyState,
          order: 10,
        });
        const disposeGenerating = ctx.desktopUi.register("chat.generating", {
          id: "standard.generating",
          component: StandardGenerating satisfies ChatGeneratingContribution["component"],
          order: 10,
        });
        const disposeStatus = ctx.desktopUi.register("chat.status", {
          id: "standard.status",
          component: StandardStatus satisfies ChatRegionContribution["component"],
          order: 10,
        });
        return () => {
          disposeSlot();
          disposeLayout();
          disposeEmpty();
          disposeGenerating();
          disposeStatus();
        };
      })(),
    "standard chat layout",
  );
}
