import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowUp,
  ChartColumn,
  Clock3,
  CornerDownLeft,
  ExternalLink,
  Eye,
  FolderGit2,
  GitCommitHorizontal,
  Image,
  KeyRound,
  LayoutDashboard,
  Lock,
  MessageCircle,
  MessagesSquare,
  Monitor,
  Package,
  Palette,
  PanelLeft,
  PanelTop,
  ScrollText,
  Search,
  Settings,
  SquareTerminal,
  TextCursorInput,
} from "lucide-react";
import {
  type ComponentType,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { TitlebarDragRegion } from "@/components/titlebar";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  type AssistantConversation,
  type AssistantMessage,
  listenAssistantMessage,
  loadAssistantConversations,
  loadAssistantEnabled,
  loadAssistantNotificationsEnabled,
  loadFeishuCredentials,
  sendAssistantMessage,
  showAssistantNotification,
  startAssistant,
} from "@/lib/assistant";
import { respondToTrafficTrigger } from "@/lib/assistant-automation";
import { appendSystemLog } from "@/lib/system-log";
import { applyTrayEnabled, loadTrayEnabled } from "@/lib/tray";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/assistant", label: "Assistant", icon: MessagesSquare },
  { to: "/automations", label: "Automations", icon: Clock3 },
  { to: "/analytics", label: "Analytics", icon: ChartColumn },
  { to: "/commit", label: "Commit", icon: GitCommitHorizontal },
  { to: "/looker", label: "Looker", icon: Eye },
  { to: "/encrypt", label: "Encrypt", icon: Lock },
  { to: "/vite-ports", label: "VitePorts", icon: SquareTerminal },
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/image-generation", label: "Image", icon: Image },
  { to: "/inputs", label: "Inputs", icon: TextCursorInput },
  { to: "/workspaces", label: "Workspaces", icon: FolderGit2 },
] satisfies Array<{
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}>;

const commandItems = [
  { ...navItems[0], keywords: ["仪表盘", "首页"] },
  { ...navItems[1], keywords: ["自动化", "任务"] },
  { ...navItems[2], keywords: ["流量分析", "数据"] },
  { ...navItems[3], keywords: ["提交", "代码提交"] },
  { ...navItems[4], label: "Looker", keywords: ["监控"] },
  { ...navItems[5], keywords: ["文本加密", "加密"] },
  { ...navItems[6], keywords: ["端口", "开发服务"] },
  { ...navItems[7], keywords: ["对话", "聊天"] },
  { ...navItems[8], keywords: ["飞书", "助理", "用户消息"] },
  { ...navItems[10], keywords: ["输入", "表单"] },
  { ...navItems[9], keywords: ["图片", "生成", "image"] },
  { to: "/settings", label: "Settings", icon: Settings, keywords: ["设置"] },
  { to: "/settings/theme", label: "主题", icon: Palette, keywords: ["theme", "外观"] },
  { to: "/settings/keys", label: "API Keys", icon: KeyRound, keywords: ["设置", "密钥", "api"] },
  { to: "/settings/models", label: "模型", icon: Package, keywords: ["设置", "models", "model"] },
  { to: "/settings/tray", label: "托盘", icon: PanelTop, keywords: ["设置", "tray"] },
  {
    to: "/settings/assistant",
    label: "助理",
    icon: MessagesSquare,
    keywords: ["设置", "飞书", "助理"],
  },
  { to: "/settings/logs", label: "系统日志", icon: ScrollText, keywords: ["设置", "日志", "logs"] },
  {
    to: "/workspaces",
    label: "Workspaces",
    icon: FolderGit2,
    keywords: ["项目", "工作区", "workspace", "git"],
  },
] satisfies Array<{
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string[];
}>;
type CommandItem = (typeof commandItems)[number];

function AppShell() {
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const isSettings = location.pathname.startsWith("/settings");
  const conversationsQuery = useQuery({
    queryKey: ["assistant-conversations"],
    queryFn: loadAssistantConversations,
  });
  const unreadCount = (conversationsQuery.data ?? []).reduce(
    (total, conversation) => total + conversation.unreadCount,
    0,
  );

  useEffect(() => {
    void appendSystemLog({ level: "info", source: "应用", message: "应用窗口已启动" }).catch(() => {
      // Logging must never prevent the app from rendering.
    });
  }, []);

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    void listenAssistantMessage((event) => {
      queryClient.setQueryData<AssistantConversation[]>(
        ["assistant-conversations"],
        (items = []) => {
          const existing = items.find((item) => item.id === event.conversation.id);
          if (!existing) return [event.conversation, ...items];
          return items.map((item) =>
            item.id === event.conversation.id ? event.conversation : item,
          );
        },
      );
      queryClient.setQueryData<AssistantMessage[]>(
        ["assistant-messages", event.message.conversationId],
        (items = []) => [...items.filter((item) => item.id !== event.message.id), event.message],
      );
      queryClient.invalidateQueries({ queryKey: ["assistant-conversations"] });
      void respondToTrafficTrigger(event, async (conversationId, text) => {
        const sent = await sendAssistantMessage(conversationId, text);
        queryClient.setQueryData<AssistantMessage[]>(
          ["assistant-messages", conversationId],
          (items = []) => [...items.filter((item) => item.id !== sent.id), sent],
        );
        queryClient.setQueryData<AssistantConversation[]>(
          ["assistant-conversations"],
          (items = []) =>
            items.map((item) =>
              item.id === conversationId
                ? {
                    ...item,
                    lastMessage: sent.text,
                    lastMessageAt: sent.timestamp,
                    unreadCount: 0,
                  }
                : item,
            ),
        );
        return sent;
      }).catch((error) => console.error("Failed to respond to traffic trigger", error));
      if (location.pathname === "/assistant") return;
      void loadAssistantNotificationsEnabled().then((enabled) => {
        if (enabled) {
          showAssistantNotification(event.conversation.displayName, event.message.text);
        }
      });
    }).then((unlisten) => {
      cleanup = unlisten;
    });
    return () => cleanup?.();
  }, [location.pathname, queryClient]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadAssistantEnabled(), loadFeishuCredentials()]).then(
      ([enabled, { appId, appSecret }]) => {
        if (active && enabled && appId && appSecret)
          void startAssistant(appId, appSecret).catch((error) =>
            console.error("Failed to start Feishu assistant", error),
          );
      },
    );
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;

    let unlisten: (() => void) | undefined;
    void listen("tray-dashboard", () => navigate("/dashboard")).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => unlisten?.();
  }, [navigate]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    void loadTrayEnabled()
      .then((enabled) => applyTrayEnabled(enabled))
      .catch((error) => console.error("Failed to apply tray setting", error));
  }, []);

  useEffect(() => {
    function handleGlobalShortcut(event: globalThis.KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsCommandMenuOpen((isOpen) => !isOpen);
      }
    }

    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, []);

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <div className="flex min-h-0 w-full flex-1 overflow-hidden bg-background">
        {isSettings ? (
          <div className="relative flex min-w-0 flex-1 flex-col bg-background">
            <section className="min-h-0 flex-1 overflow-y-auto">
              <Outlet />
            </section>
            <div className="absolute inset-x-0 top-0 z-10 flex h-8 items-center">
              <TitlebarDragRegion />
            </div>
          </div>
        ) : null}
        {!isSettings ? (
          <>
            {/* 左列：红绿灯 + 侧栏同一背景，连成一体 */}
            <aside className="flex w-[280px] shrink-0 flex-col border-border border-r bg-card max-md:w-[72px] max-sm:w-16">
              <div className="flex h-8 shrink-0 items-center select-none">
                <TitlebarDragRegion />
              </div>
              <SidebarHeader />
              <nav
                className="space-y-1 px-3 py-2 max-md:px-2 max-sm:px-1.5"
                aria-label="Main navigation"
              >
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isAssistant = item.to === "/assistant";

                  return (
                    <NavLink
                      className={({ isActive }) =>
                        `flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors ${
                          isActive
                            ? "bg-background text-foreground shadow-xs ring-1 ring-border"
                            : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                        } max-md:justify-center max-md:px-0 max-sm:h-8`
                      }
                      key={item.to}
                      to={item.to}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className="max-md:hidden">{item.label}</span>
                      {isAssistant && unreadCount > 0 ? (
                        <span
                          aria-label={`未读消息 ${unreadCount} 条`}
                          className="ml-auto inline-flex min-w-4 items-center justify-center rounded-full bg-primary/12 px-1.5 py-0.5 font-medium text-[10px] text-primary dark:bg-cyan-400/20 dark:text-cyan-200 max-md:hidden"
                          role="status"
                          title={`未读消息 ${unreadCount} 条`}
                        >
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      ) : null}
                    </NavLink>
                  );
                })}
              </nav>

              <div className="min-h-0 flex-1" />

              <footer className="relative mt-auto border-border border-t px-3 max-md:px-2 max-sm:px-1.5">
                <details className="group">
                  <summary className="flex h-12 cursor-pointer list-none items-center justify-between rounded-md px-3 text-left text-sm font-semibold text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground max-md:justify-center max-md:px-0 max-sm:h-10 [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar className="size-6 bg-foreground text-[10px] font-bold text-background">
                        <AvatarFallback className="bg-foreground text-[10px] font-bold text-background">
                          O
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate max-md:hidden">OpenAI</span>
                    </span>
                  </summary>
                  <div className="absolute right-3 bottom-full left-3 mb-2 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg max-md:right-2 max-md:left-2 max-sm:right-1.5 max-sm:left-1.5">
                    <NavLink
                      className={({ isActive }) =>
                        `flex h-9 items-center gap-2 rounded-sm px-2 text-sm transition-colors ${
                          isActive
                            ? "bg-accent text-accent-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                        } max-md:justify-center max-md:px-0`
                      }
                      to="/settings"
                    >
                      <Settings className="size-4 shrink-0" />
                      <span className="max-md:hidden">Settings</span>
                    </NavLink>
                  </div>
                </details>
              </footer>
            </aside>

            {/* 右列：内容区铺满到窗口顶部，拖拽条透明浮在上方 */}
            <div className="relative flex min-w-0 flex-1 flex-col bg-background max-sm:w-[calc(100vw-4rem)]">
              <section className="min-h-0 flex-1 overflow-y-auto">
                <Outlet />
              </section>
              <div className="absolute inset-x-0 top-0 z-10 flex h-8 items-center">
                <TitlebarDragRegion />
                <TopActions onOpenCommandMenu={() => setIsCommandMenuOpen(true)} />
              </div>
            </div>
          </>
        ) : null}
      </div>
      {isCommandMenuOpen && <CommandMenu onClose={() => setIsCommandMenuOpen(false)} />}
    </main>
  );
}

function SidebarHeader() {
  return (
    <header className="flex items-center px-3 pt-4 pb-3 max-md:justify-center max-md:px-2 max-sm:px-1.5">
      <h1 className="truncate pl-2 font-semibold text-base text-muted-foreground max-md:hidden">
        m-dashboard
      </h1>
    </header>
  );
}

function TopActions({ onOpenCommandMenu }: { onOpenCommandMenu: () => void }) {
  return (
    <div className="mt-1 flex items-center gap-1.5 px-3 text-muted-foreground max-sm:gap-0.5 max-sm:px-2">
      <Button
        aria-label="Open command menu"
        className="hidden h-8 gap-1.5 px-2 text-xs sm:inline-flex"
        onClick={onOpenCommandMenu}
        type="button"
        variant="ghost"
      >
        <Search className="size-3.5" />
        <span aria-hidden="true">⌘ K</span>
      </Button>
      <Button
        aria-label="Minimize panel"
        className="size-8"
        size="icon"
        type="button"
        variant="ghost"
      >
        <Monitor className="size-4" />
      </Button>
      <Button
        aria-label="Toggle panel"
        className="size-8"
        size="icon"
        type="button"
        variant="ghost"
      >
        <PanelLeft className="size-4 rotate-180" />
      </Button>
    </div>
  );
}

function CommandMenu({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);

  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return commandItems;
    return commandItems.filter((item) =>
      [item.label, item.to, ...item.keywords].some((value) =>
        value.toLowerCase().includes(normalizedQuery),
      ),
    );
  }, [query]);
  const hasGoogleSearch = query.trim().length > 0 && matches.length === 0;
  const resultCount = matches.length + (hasGoogleSearch ? 1 : 0);

  useEffect(() => inputRef.current?.focus(), []);
  async function selectItem(item: CommandItem | "google") {
    if (item === "google") {
      const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(query.trim())}`;
      try {
        if ("__TAURI_INTERNALS__" in window) {
          await openUrl(searchUrl);
        } else {
          window.open(searchUrl, "_blank", "noopener,noreferrer");
        }
      } catch {
        window.open(searchUrl, "_blank", "noopener,noreferrer");
      }
    } else {
      navigate(item.to);
    }
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % resultCount);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + resultCount) % resultCount);
    } else if (event.key === "Enter") {
      event.preventDefault();
      selectItem(matches[activeIndex] ?? "google");
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div
      aria-label="Command menu"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/35 px-4 pt-[13vh] backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
      role="dialog"
    >
      <section
        aria-label="Global command menu"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl"
        role="document"
      >
        <div className="flex h-14 items-center gap-3 border-border border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            aria-label="Search commands"
            autoCapitalize="none"
            autoCorrect="off"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search menus or Google..."
            ref={inputRef}
            spellCheck={false}
            value={query}
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>

        <div className="max-h-[min(55vh,360px)] overflow-y-auto p-2">
          {matches.map((item, index) => {
            const Icon = item.icon;
            const isActive = activeIndex === index;
            return (
              <button
                className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors ${isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"}`}
                key={item.to}
                onClick={() => selectItem(item)}
                onMouseEnter={() => setActiveIndex(index)}
                type="button"
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{item.label}</span>
                {isActive && <CornerDownLeft className="size-3.5 opacity-70" />}
              </button>
            );
          })}
          {hasGoogleSearch && (
            <button
              className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors ${activeIndex === matches.length ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"}`}
              onClick={() => selectItem("google")}
              onMouseEnter={() => setActiveIndex(matches.length)}
              type="button"
            >
              <ExternalLink className="size-4 shrink-0" />
              <span className="min-w-0 flex-1 truncate">
                Search Google for <span className="font-medium">&quot;{query.trim()}&quot;</span>
              </span>
              {activeIndex === matches.length && <CornerDownLeft className="size-3.5 opacity-70" />}
            </button>
          )}
          {resultCount === 0 && (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Type a search to open Google.
            </p>
          )}
        </div>

        <footer className="flex items-center gap-4 border-border border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ArrowUp className="size-3" />
            <ArrowDown className="size-3" />
            Navigate
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="size-3" />
            Select
          </span>
        </footer>
      </section>
    </div>
  );
}

export { AppShell };
