import { useQuery } from "@tanstack/react-query";
import { RefreshCw, ScrollText } from "lucide-react";
import { ChatBrowser } from "@/components/chat-browser";
import { ChatContextDetail } from "@/components/chat-context-detail";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ChatTerminal } from "@/components/chat-terminal";
import { SideChat } from "@/components/side-chat";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getBrowserNavigationState,
  getBrowserPreviewTitle,
  moveBrowserNavigation,
  pushBrowserNavigation,
} from "@/lib/browser-preview";
import { loadChatPlan, loadChatPlans } from "@/lib/chat-server";
import type { WorkspaceTabRenderProps } from "@/lib/desktop-ui";
import { requestPlanExecution } from "@/lib/plan-viewer-events";

export function TerminalTabRenderer({ tab, scope }: WorkspaceTabRenderProps<"terminal">) {
  return <ChatTerminal cwd={tab.data.cwd ?? scope.cwd} sessionKey={tab.id} />;
}

export function BrowserTabRenderer({ tab, updateTab }: WorkspaceTabRenderProps<"browser">) {
  const navigation = getBrowserNavigationState({ browserNavigation: tab.data.navigation });
  const navigate = (url: string) =>
    updateTab({
      navigation: pushBrowserNavigation({ browserNavigation: tab.data.navigation }, url),
      loadUrl: url,
      title: getBrowserPreviewTitle(url),
      url,
      refreshToken: Date.now(),
    });
  const move = (offset: -1 | 1) => {
    const next = moveBrowserNavigation({ browserNavigation: tab.data.navigation }, offset);
    if (next) updateTab({ navigation: next.browserNavigation, loadUrl: next.url });
  };
  return (
    <ChatBrowser
      canGoBack={navigation.index > 0}
      canGoForward={navigation.index < navigation.entries.length - 1}
      frameName={tab.id}
      loadUrl={tab.data.loadUrl}
      onBack={() => move(-1)}
      onForward={() => move(1)}
      onNavigate={navigate}
      onRefresh={() =>
        tab.data.url && updateTab({ loadUrl: tab.data.url, refreshToken: Date.now() })
      }
      refreshToken={tab.data.refreshToken}
      url={tab.data.url}
    />
  );
}

export function ImageTabRenderer({ tab }: WorkspaceTabRenderProps<"image">) {
  return (
    <div className="chat-image-preview">
      {tab.data.url ? (
        <img alt={tab.title} src={tab.data.url} />
      ) : (
        <p className="chat-image-preview-empty">无图片</p>
      )}
    </div>
  );
}

export function SideChatTabRenderer({ tab }: WorkspaceTabRenderProps<"chat">) {
  return (
    <SideChat
      contextMessages={tab.data.messages ?? []}
      draft={tab.data.draft}
      draftRevision={tab.data.draftRevision ?? 0}
      sessionId={tab.data.sessionId ?? ""}
    />
  );
}

export function ContextDetailTabRenderer({ tab }: WorkspaceTabRenderProps<"context-detail">) {
  if (!tab.data.promptInput) return <UnavailableWorkspaceTab />;
  return (
    <ChatContextDetail
      messages={tab.data.messages ?? []}
      promptInput={tab.data.promptInput}
      sessionId={tab.data.sessionId ?? ""}
      systemPrompt={tab.data.systemPrompt}
    />
  );
}

export function PlanTabRenderer({ tab, updateTab }: WorkspaceTabRenderProps<"plan">) {
  const plans = useQuery({
    queryKey: ["chat-plans", tab.data.sessionId],
    queryFn: () => loadChatPlans(tab.data.sessionId ?? ""),
    enabled: Boolean(tab.data.sessionId),
  });
  const plan = useQuery({
    queryKey: ["chat-plan", tab.data.sessionId, tab.data.planId],
    queryFn: () => loadChatPlan(tab.data.sessionId ?? "", tab.data.planId ?? ""),
    enabled: Boolean(tab.data.sessionId && tab.data.planId),
  });
  const content = tab.data.content ?? plan.data?.content ?? "";
  return (
    <div className="chat-explorer-shell">
      <header className="chat-explorer-toolbar">
        <span className="chat-explorer-title">{tab.title}</span>
        <span className="chat-explorer-toolbar-actions">
          <span className="file-viewer-readonly">只读计划</span>
          {tab.data.canExecute && tab.data.sessionId && tab.data.planId ? (
            <Button
              className="!h-7 !gap-1.5 !px-2.5 !text-[11px]"
              onClick={() =>
                requestPlanExecution({
                  sessionId: tab.data.sessionId ?? "",
                  planId: tab.data.planId ?? "",
                })
              }
              size="sm"
              type="button"
            >
              执行计划
            </Button>
          ) : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label="选择历史计划"
                className="chat-workspace-window-add"
                size="icon"
                type="button"
                variant="ghost"
              >
                <ScrollText className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={6}>
              {plans.isLoading ? (
                <DropdownMenuItem disabled>加载中...</DropdownMenuItem>
              ) : plans.data?.length ? (
                plans.data.map((item) => (
                  <DropdownMenuItem
                    key={item.id}
                    onSelect={() =>
                      updateTab({ title: item.fileName, planId: item.id, content: undefined })
                    }
                  >
                    <ScrollText className="size-3.5" />
                    {item.fileName}
                  </DropdownMenuItem>
                ))
              ) : (
                <DropdownMenuItem disabled>暂无历史计划</DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            aria-label="刷新计划"
            className="chat-workspace-window-add"
            onClick={() => void plan.refetch()}
            size="icon"
            type="button"
            variant="ghost"
          >
            <RefreshCw className="size-4" />
          </Button>
        </span>
      </header>
      <div className="chat-explorer-editor-pane">
        <div className="chat-plan-preview">
          {plan.isLoading && tab.data.content === undefined ? (
            <div aria-label="加载计划" className="chat-plan-preview-skeleton" role="status">
              <span />
              <span />
              <span />
              <span />
            </div>
          ) : content.trim() ? (
            <div className="chat-message-text chat-plan-preview-content">
              <ChatMarkdown isAnimating={false}>{content}</ChatMarkdown>
            </div>
          ) : (
            <div className="chat-workspace-window-empty">计划正在生成...</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function UnavailableWorkspaceTab() {
  return <div className="chat-workspace-window-empty">该工具当前不可用</div>;
}
