import type {
  ChatContributionScope,
  ChatEmptyStateProps,
  ChatGeneratingContribution,
  ChatGenerationSnapshot,
  ChatRegionContribution,
  DesktopPluginModule,
} from "@chatdesk/desktop-plugin-sdk";
import type { Context } from "cordis";
import { Terminal } from "lucide-react";
import type { ReactNode } from "react";
import type { ChatLayoutProps } from "@/lib/chat-layout";
import { useChatLayoutId } from "@/lib/chat-layout";

export const manifest = {
  id: "chat-layout-geek",
  builtin: true,
  name: "Geek 聊天布局",
  description: "为 Chat 页面提供偏开发者风格的代码主题布局。",
  version: "1.0.0",
  apiVersion: 1,
  entry: "plugins/chat-layout-geek",
  contributes: ["chat.layout", "chat.messages.empty", "chat.generating", "chat.status"],
  permissions: [],
} as const;
export const inject: DesktopPluginModule["inject"] = ["desktopUi", "chatLayouts"];

const glyphs = [
  { id: "binary-a", text: "01" },
  { id: "braces", text: "{}" },
  { id: "arrow", text: "=>" },
  { id: "comment", text: "//" },
  { id: "tag", text: "</>" },
  { id: "prompt", text: "$" },
  { id: "brackets", text: "[]" },
  { id: "and", text: "&&" },
  { id: "scope", text: "::" },
  { id: "binary-b", text: "10" },
] as const;

const LAYOUT_STYLES = `
  .chat-empty-geek {
    font-family: var(--chat-code-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  }
  .chat-empty-geek .chat-empty-mark {
    border-radius: 4px;
    background: color-mix(in srgb, var(--chat-geek-accent-soft) 24%, transparent);
    color: var(--chat-geek-accent);
  }
  .chat-geek-prompts {
    display: flex;
    flex-direction: column;
    gap: 8px;
    width: 100%;
    max-width: 320px;
    margin-top: 8px;
  }
  .chat-geek-prompt {
    display: flex;
    align-items: center;
    gap: 8px;
    border: 1px dashed color-mix(in srgb, var(--chat-geek-accent) 28%, var(--border));
    border-radius: 4px;
    background: color-mix(in srgb, var(--chat-geek-accent-soft) 10%, transparent);
    padding: 8px 12px;
    text-align: left;
    font-size: 12px;
    color: var(--foreground);
    transition: background 120ms ease;
  }
  .chat-geek-prompt:hover {
    background: color-mix(in srgb, var(--chat-geek-accent-soft) 22%, transparent);
  }
  .chat-geek-prompt-sign {
    color: var(--chat-geek-accent);
    font-weight: 600;
  }
  .chat-generating-geek {
    font-family: var(--chat-code-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  }
  .chat-generating-geek .chat-geek-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    max-width: 180px;
    height: 8px;
    margin-top: 6px;
    border-radius: 2px;
    background: color-mix(in srgb, var(--chat-geek-accent) 14%, var(--muted));
    overflow: hidden;
  }
  .chat-generating-geek .chat-geek-progress-bar {
    display: block;
    height: 100%;
    width: 45%;
    border-radius: 2px;
    background: var(--chat-geek-accent);
    animation: chat-geek-progress 1.6s ease-in-out infinite;
  }
  .chat-generating-geek .chat-geek-progress-cursor {
    width: 6px;
    height: 10px;
    background: var(--chat-geek-accent);
    animation: chat-geek-blink 1s step-end infinite;
  }
  .chat-status-geek {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    border-radius: 2px;
    border: 1px solid color-mix(in srgb, var(--chat-geek-accent) 32%, var(--border));
    background: color-mix(in srgb, var(--chat-geek-accent-soft) 16%, transparent);
    padding: 2px 8px;
    font-family: var(--chat-code-font, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
    font-size: 11px;
    color: var(--chat-geek-accent);
  }
  @keyframes chat-geek-progress {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(220%); }
  }
  @keyframes chat-geek-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .chat-generating-geek .chat-geek-progress-bar,
    .chat-generating-geek .chat-geek-progress-cursor {
      animation: none;
    }
  }
`;

function LayoutSlot({ children, layoutId }: { children: ReactNode; layoutId: string }) {
  const active = useChatLayoutId() === layoutId;
  if (!active) return null;
  return <>{children}</>;
}

function GeekEmptyState({ setInput, focus }: ChatEmptyStateProps) {
  return (
    <LayoutSlot layoutId="geek">
      <div className="chat-empty-state chat-empty-geek">
        <div aria-hidden="true" className="chat-empty-mark">
          <Terminal className="size-8" />
        </div>
        <h2>user@chatdesk:~$ start</h2>
        <div className="chat-geek-prompts">
          <button
            className="chat-geek-prompt"
            onClick={() => {
              setInput("请帮我探索并理解这个代码库。");
              focus();
            }}
            type="button"
          >
            <span className="chat-geek-prompt-sign">$</span>
            <span>explore-repo</span>
          </button>
          <button
            className="chat-geek-prompt"
            onClick={() => {
              setInput("请帮我构建一个新功能。");
              focus();
            }}
            type="button"
          >
            <span className="chat-geek-prompt-sign">$</span>
            <span>build-feature</span>
          </button>
          <button
            className="chat-geek-prompt"
            onClick={() => {
              setInput("请帮我定位并修复这个问题。");
              focus();
            }}
            type="button"
          >
            <span className="chat-geek-prompt-sign">$</span>
            <span>fix-bug</span>
          </button>
        </div>
      </div>
    </LayoutSlot>
  );
}

function GeekGenerating({
  generation,
}: {
  scope: ChatContributionScope;
  generation: ChatGenerationSnapshot;
}) {
  return (
    <LayoutSlot layoutId="geek">
      <div className="chat-message assistant-message chat-generating-geek">
        <div className="chat-message-body">
          <div className="chat-message-meta">
            <span>{generation.phase || "compiling"}</span>
          </div>
          <div className="chat-geek-progress">
            <span className="chat-geek-progress-bar" />
            <span className="chat-geek-progress-cursor" />
          </div>
        </div>
      </div>
    </LayoutSlot>
  );
}

function GeekStatus(_props: { scope: ChatContributionScope }) {
  return (
    <LayoutSlot layoutId="geek">
      <span className="chat-status-geek">
        <Terminal aria-hidden="true" className="size-3" />
        theme://geek
      </span>
    </LayoutSlot>
  );
}

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      (() => {
        const layoutComponent = ({ children }: ChatLayoutProps) => (
          <div className="chat-layout-root chat-layout-geek">
            <style>{LAYOUT_STYLES}</style>
            <div aria-hidden="true" className="chat-geek-streams">
              {glyphs.map((glyph, index) => (
                <span className={`chat-geek-glyph is-${index + 1}`} key={glyph.id}>
                  {glyph.text}
                </span>
              ))}
            </div>
            {children}
          </div>
        );
        const disposeSlot = ctx.desktopUi.register("chat.layout", {
          id: "geek",
          label: "Geek",
          component: layoutComponent,
        });
        const disposeLayout = ctx.chatLayouts.register("geek", layoutComponent);
        const disposeEmpty = ctx.desktopUi.register("chat.messages.empty", {
          id: "geek.empty",
          component: GeekEmptyState,
          order: 10,
        });
        const disposeGenerating = ctx.desktopUi.register("chat.generating", {
          id: "geek.generating",
          component: GeekGenerating satisfies ChatGeneratingContribution["component"],
          order: 10,
        });
        const disposeStatus = ctx.desktopUi.register("chat.status", {
          id: "geek.status",
          component: GeekStatus satisfies ChatRegionContribution["component"],
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
    "geek chat layout",
  );
}
