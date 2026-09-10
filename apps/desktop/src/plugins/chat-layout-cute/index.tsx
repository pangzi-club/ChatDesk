import type {
  ChatContributionScope,
  ChatEmptyStateProps,
  ChatGeneratingContribution,
  ChatGenerationSnapshot,
  ChatRegionContribution,
  DesktopPluginModule,
} from "@chatdesk/desktop-plugin-sdk";
import type { Context } from "cordis";
import { Cloud, Fish, Hammer, SearchCode, Sparkles, Waves } from "lucide-react";
import type { ReactNode } from "react";
import type { ChatLayoutProps } from "@/lib/chat-layout";
import { useChatLayoutId } from "@/lib/chat-layout";

export const manifest = {
  id: "chat-layout-cute",
  builtin: true,
  name: "可爱聊天布局",
  description: "为 Chat 页面提供轻松活泼的海洋主题布局。",
  version: "1.0.0",
  apiVersion: 1,
  entry: "plugins/chat-layout-cute",
  contributes: ["chat.layout", "chat.messages.empty", "chat.generating", "chat.status"],
  permissions: [],
} as const;
export const inject: DesktopPluginModule["inject"] = ["desktopUi", "chatLayouts"];

const EMPTY_ACTIONS = [
  { label: "探索代码", prompt: "请帮我探索并理解这个代码库。", icon: SearchCode },
  { label: "做个小工具", prompt: "请帮我构建一个有趣的小工具。", icon: Hammer },
] as const;

const LAYOUT_STYLES = `
  .chat-empty-cute .chat-empty-mark {
    position: relative;
    display: grid;
    place-items: center;
    width: 72px;
    height: 72px;
  }
  .chat-cute-empty-waves {
    position: absolute;
    inset: 0;
    opacity: 0.22;
    color: var(--chat-cute-accent);
    animation: chat-cute-wave 7s ease-in-out infinite alternate;
  }
  .chat-cute-empty-fish {
    position: absolute;
    width: 28px;
    height: 28px;
    color: var(--chat-cute-accent);
    animation: chat-cute-swim 12s linear infinite;
  }
  .chat-cute-empty-sparkle {
    position: absolute;
    top: 8px;
    right: 4px;
    width: 16px;
    height: 16px;
    color: var(--chat-cute-accent);
    animation: chat-cute-twinkle 2.8s ease-in-out infinite;
  }
  .chat-generating-cute .chat-cute-bubbles {
    display: flex;
    align-items: flex-end;
    gap: 5px;
    height: 22px;
    padding: 4px 0;
  }
  .chat-generating-cute .chat-cute-bubbles span {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--chat-cute-accent) 55%, var(--card));
    animation: chat-cute-bubble 1.2s ease-in-out infinite;
  }
  .chat-generating-cute .chat-cute-bubbles span:nth-child(2) { animation-delay: 0.15s; }
  .chat-generating-cute .chat-cute-bubbles span:nth-child(3) { animation-delay: 0.3s; }
  .chat-generating-cute .chat-cute-bubbles span:nth-child(4) { animation-delay: 0.45s; }
  .chat-status-cute {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--chat-cute-accent) 32%, var(--border));
    background: color-mix(in srgb, var(--chat-cute-accent-soft) 24%, transparent);
    padding: 2px 10px;
    font-size: 11px;
    color: color-mix(in srgb, var(--chat-cute-accent) 80%, var(--foreground));
  }
  @keyframes chat-cute-bubble {
    0%, 100% { transform: translateY(0); opacity: 0.5; }
    50% { transform: translateY(-8px); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .chat-cute-empty-waves,
    .chat-cute-empty-fish,
    .chat-cute-empty-sparkle,
    .chat-generating-cute .chat-cute-bubbles span {
      animation: none;
    }
  }
`;

function LayoutSlot({ children, layoutId }: { children: ReactNode; layoutId: string }) {
  const active = useChatLayoutId() === layoutId;
  if (!active) return null;
  return <>{children}</>;
}

function CuteEmptyState({ setInput, focus }: ChatEmptyStateProps) {
  return (
    <LayoutSlot layoutId="cute">
      <div className="chat-empty-state chat-empty-cute">
        <div aria-hidden="true" className="chat-empty-mark">
          <Waves className="chat-cute-empty-waves" />
          <Fish className="chat-cute-empty-fish" />
          <Sparkles className="chat-cute-empty-sparkle" />
        </div>
        <h2>嗨，要一起遨游这片代码海洋吗？</h2>
        <div className="chat-suggestion-grid">
          {EMPTY_ACTIONS.map((action) => {
            const Icon = action.icon;
            return (
              <button
                className="chat-suggestion-card is-blue"
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

function CuteGenerating({
  generation,
}: {
  scope: ChatContributionScope;
  generation: ChatGenerationSnapshot;
}) {
  return (
    <LayoutSlot layoutId="cute">
      <div className="chat-message assistant-message chat-generating-cute">
        <div className="chat-message-body">
          <div className="chat-message-meta">
            <Fish aria-hidden="true" className="size-3.5" />
            <span>{generation.phase || "小鱼正在思考…"}</span>
          </div>
          <div className="chat-cute-bubbles">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
      </div>
    </LayoutSlot>
  );
}

function CuteStatus(_props: { scope: ChatContributionScope }) {
  return (
    <LayoutSlot layoutId="cute">
      <span className="chat-status-cute">
        <Cloud aria-hidden="true" className="size-3" />
        可爱模式
      </span>
    </LayoutSlot>
  );
}

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      (() => {
        const layoutComponent = ({ children }: ChatLayoutProps) => (
          <div className="chat-layout-root chat-layout-cute">
            <style>{LAYOUT_STYLES}</style>
            <div aria-hidden="true" className="chat-cute-scenery">
              <Cloud className="chat-cute-cloud is-one" />
              <Cloud className="chat-cute-cloud is-two" />
              <Cloud className="chat-cute-cloud is-three" />
              <Fish className="chat-cute-fish is-one" />
              <Fish className="chat-cute-fish is-two" />
              <Fish className="chat-cute-fish is-three" />
              <Sparkles className="chat-cute-sparkle is-one" />
              <Sparkles className="chat-cute-sparkle is-two" />
              <Waves className="chat-cute-waves" />
            </div>
            {children}
          </div>
        );
        const disposeSlot = ctx.desktopUi.register("chat.layout", {
          id: "cute",
          label: "可爱",
          component: layoutComponent,
        });
        const disposeLayout = ctx.chatLayouts.register("cute", layoutComponent);
        const disposeEmpty = ctx.desktopUi.register("chat.messages.empty", {
          id: "cute.empty",
          component: CuteEmptyState,
          order: 10,
        });
        const disposeGenerating = ctx.desktopUi.register("chat.generating", {
          id: "cute.generating",
          component: CuteGenerating satisfies ChatGeneratingContribution["component"],
          order: 10,
        });
        const disposeStatus = ctx.desktopUi.register("chat.status", {
          id: "cute.status",
          component: CuteStatus satisfies ChatRegionContribution["component"],
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
    "cute chat layout",
  );
}
