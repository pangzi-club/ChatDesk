import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  ArrowDown,
  ArrowUp,
  Brain,
  ChartColumn,
  ChevronDown,
  CircleAlert,
  Clock3,
  CornerDownLeft,
  ExternalLink,
  Eye,
  FolderGit2,
  GitCommitHorizontal,
  History,
  Image,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Lock,
  MessageCircle,
  Monitor,
  Package,
  Palette,
  PanelLeft,
  PanelTop,
  PlugZap,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  Settings,
  Shield,
  Sparkles,
  SquareTerminal,
  TextCursorInput,
  Trash2,
  Wrench,
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { rememberReturnPath } from "@/lib/app-return-path";
import {
  type ChatServerSession,
  canRestartChatServer,
  getChatServerStatus,
  loadChatServerPort,
  restartChatServer,
  subscribeChatServerEvents,
} from "@/lib/chat-server";
import { type ChatIndexItem, deleteChatSession, loadChatIndex } from "@/lib/chat-store";
import { appendSystemLog } from "@/lib/system-log";
import { applyTrayEnabled, loadTrayEnabled } from "@/lib/tray";
import { loadWorkspaceProjects } from "@/lib/workspaces";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/image-generation", label: "Image", icon: Image },
  { to: "/automations", label: "Automations", icon: Clock3 },
  { to: "/workspaces", label: "Workspaces", icon: FolderGit2 },
  { to: "/dev-tools", label: "Dev Tools", icon: Wrench },
] satisfies Array<{
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}>;

const commandItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, keywords: ["仪表盘", "首页"] },
  { to: "/chat", label: "Chat", icon: MessageCircle, keywords: ["对话", "聊天"] },
  { to: "/automations", label: "Automations", icon: Clock3, keywords: ["自动化", "任务"] },
  {
    to: "/workspaces",
    label: "Workspaces",
    icon: FolderGit2,
    keywords: ["项目", "工作区", "workspace", "git"],
  },
  {
    to: "/image-generation",
    label: "Image",
    icon: Image,
    keywords: ["图片", "生成", "image"],
  },
  {
    to: "/dev-tools",
    label: "Dev Tools",
    icon: Wrench,
    keywords: ["开发工具", "devtools", "工具"],
  },
  {
    to: "/dev-tools/encrypt",
    label: "Encrypt",
    icon: Lock,
    keywords: ["文本加密", "加密", "devtools"],
  },
  {
    to: "/dev-tools/vite-ports",
    label: "VitePorts",
    icon: SquareTerminal,
    keywords: ["端口", "开发服务", "vite", "devtools"],
  },
  {
    to: "/dev-tools/inputs",
    label: "Inputs",
    icon: TextCursorInput,
    keywords: ["输入", "表单", "devtools"],
  },
  {
    to: "/dev-tools/analytics",
    label: "Analytics",
    icon: ChartColumn,
    keywords: ["流量分析", "数据", "devtools"],
  },
  {
    to: "/dev-tools/commit",
    label: "Commit",
    icon: GitCommitHorizontal,
    keywords: ["提交", "代码提交", "devtools"],
  },
  {
    to: "/dev-tools/looker",
    label: "Looker",
    icon: Eye,
    keywords: ["监控", "devtools"],
  },
  {
    to: "/dev-tools/sandbox",
    label: "Sandbox",
    icon: Shield,
    keywords: ["沙箱", "sandbox", "agent", "工作区", "权限", "devtools"],
  },
  { to: "/settings", label: "Settings", icon: Settings, keywords: ["设置"] },
  { to: "/settings/theme", label: "主题", icon: Palette, keywords: ["theme", "外观"] },
  { to: "/settings/keys", label: "API Keys", icon: KeyRound, keywords: ["设置", "密钥", "api"] },
  { to: "/settings/models", label: "模型", icon: Package, keywords: ["设置", "models", "model"] },
  {
    to: "/settings/mcp",
    label: "MCP",
    icon: PlugZap,
    keywords: ["设置", "mcp", "模型上下文协议", "插件", "服务器", "工具"],
  },
  {
    to: "/settings/skills",
    label: "Skills",
    icon: Sparkles,
    keywords: ["设置", "skills", "skill", "技能", "提示词", "工作流"],
  },
  {
    to: "/settings/tools",
    label: "Tools",
    icon: Wrench,
    keywords: ["设置", "tools", "工具", "工具包", "chat tools"],
  },
  {
    to: "/settings/memory",
    label: "长期记忆",
    icon: Brain,
    keywords: ["设置", "memory", "记忆", "长期记忆"],
  },
  {
    to: "/settings/history",
    label: "History",
    icon: History,
    keywords: ["设置", "历史", "对话历史", "归档", "导入", "codex", "claude"],
  },
  { to: "/settings/tray", label: "托盘", icon: PanelTop, keywords: ["设置", "tray"] },
  {
    to: "/settings/chat-server",
    label: "Chat Server",
    icon: Server,
    keywords: ["设置", "chat", "server", "端口", "localhost", "hono"],
  },
  {
    to: "/settings/logs",
    label: "活动记录",
    icon: ScrollText,
    keywords: ["设置", "活动", "记录", "日志", "logs"],
  },
] satisfies Array<{
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  keywords: string[];
}>;
type CommandItem = (typeof commandItems)[number];

const CHAT_UNREAD_STORAGE_KEY = "m-dashboard-chat-unread-v1";

function loadUnreadChatIds() {
  if (typeof window === "undefined") return new Set<string>();
  try {
    const value = JSON.parse(window.localStorage.getItem(CHAT_UNREAD_STORAGE_KEY) ?? "[]");
    return new Set(
      Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [],
    );
  } catch {
    return new Set<string>();
  }
}

function saveUnreadChatIds(ids: Set<string>) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(CHAT_UNREAD_STORAGE_KEY, JSON.stringify([...ids]));
  }
}

function AppShell() {
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const hideMainSidebar =
    location.pathname.startsWith("/settings") || location.pathname.startsWith("/dev-tools/");
  const lockOutletScroll =
    location.pathname.startsWith("/dev-tools/sandbox") ||
    location.pathname.startsWith("/settings/history");

  useEffect(() => {
    rememberReturnPath(location.pathname, location.search);
  }, [location.pathname, location.search]);

  useEffect(() => {
    void appendSystemLog({ level: "info", source: "应用", message: "应用窗口已启动" }).catch(() => {
      // Logging must never prevent the app from rendering.
    });
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
      <ChatServerStatusBanner />
      <div className="flex min-h-0 w-full flex-1 overflow-hidden bg-background">
        {hideMainSidebar ? (
          <div className="relative flex min-w-0 flex-1 flex-col bg-background">
            <section
              className={`min-h-0 flex-1 ${lockOutletScroll ? "overflow-hidden" : "overflow-y-auto"}`}
            >
              <Outlet />
            </section>
            <div className="absolute inset-x-0 top-0 z-10 flex h-8 items-center">
              <TitlebarDragRegion />
            </div>
          </div>
        ) : null}
        {!hideMainSidebar ? (
          <>
            {/* 左列：红绿灯 + 侧栏同一背景，连成一体 */}
            <aside className="flex w-[272px] shrink-0 flex-col border-border border-r bg-card max-md:w-[72px] max-sm:w-16">
              <div className="flex h-8 shrink-0 items-center select-none">
                <TitlebarDragRegion />
              </div>
              <SidebarHeader />
              <nav
                className="space-y-0.5 px-3 py-2 pb-1 max-md:px-2 max-sm:px-1.5"
                aria-label="Main navigation"
              >
                {navItems.slice(0, 2).map((item) => (
                  <SidebarNavItem item={item} key={item.to} />
                ))}
              </nav>
              <div className="min-h-0 flex-1 overflow-y-auto">
                <nav
                  className="space-y-0.5 px-3 pt-0 pb-2 max-md:px-2 max-sm:px-1.5"
                  aria-label="Secondary navigation"
                >
                  {navItems.slice(2).map((item) => (
                    <SidebarNavItem item={item} key={item.to} />
                  ))}
                </nav>
                <WorkspaceConversationGroups />
              </div>

              <footer className="relative mt-auto border-border border-t px-3 py-1 max-md:px-2 max-sm:px-1.5">
                <details className="group">
                  <summary className="flex h-8 cursor-pointer list-none items-center justify-between rounded-md px-3 text-left text-[13px] font-semibold text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground max-md:justify-center max-md:px-0 [&::-webkit-details-marker]:hidden">
                    <span className="flex min-w-0 items-center gap-2">
                      <Avatar className="size-5 bg-primary text-[9px] font-bold text-primary-foreground">
                        <AvatarFallback className="bg-primary text-[9px] font-bold text-primary-foreground">
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

function ChatServerStatusBanner() {
  const queryClient = useQueryClient();
  const enabled = canRestartChatServer();
  const statusQuery = useQuery({
    queryKey: ["chat-server-status"],
    queryFn: getChatServerStatus,
    enabled,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
    retry: false,
  });
  const previousState = useRef<string | undefined>(undefined);
  const restartMutation = useMutation({
    mutationFn: restartChatServer,
    onSuccess: () => {
      void statusQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["chat-index"] });
    },
  });

  useEffect(() => {
    const state = statusQuery.data?.state;
    if (state === "running" && previousState.current && previousState.current !== "running") {
      void queryClient.invalidateQueries({ queryKey: ["chat-index"] });
      void queryClient.invalidateQueries({ queryKey: ["chat-server-config"] });
    }
    previousState.current = state;
  }, [queryClient, statusQuery.data?.state]);

  if (!enabled || !statusQuery.data || statusQuery.data.state === "running") return null;

  const isRestarting =
    statusQuery.data.state === "starting" || statusQuery.data.state === "restarting";
  return (
    <div
      aria-live="polite"
      className={`flex min-h-10 shrink-0 items-center justify-between gap-3 border-border border-b px-4 py-2 text-xs max-sm:items-start ${isRestarting ? "bg-amber-500/10 text-amber-800 dark:text-amber-200" : "bg-destructive/10 text-destructive"}`}
      role="status"
    >
      <div className="flex min-w-0 items-center gap-2">
        {isRestarting ? (
          <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin" />
        ) : (
          <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
        )}
        <span className="truncate">
          {isRestarting ? "Chat Server 正在恢复" : "Chat Server 当前不可用"}
        </span>
      </div>
      <Button
        className="h-7 shrink-0 px-2 text-xs"
        disabled={restartMutation.isPending || isRestarting}
        onClick={() => restartMutation.mutate()}
        size="sm"
        type="button"
        variant="outline"
      >
        <RefreshCw className={restartMutation.isPending ? "size-3.5 animate-spin" : "size-3.5"} />
        重启服务
      </Button>
    </div>
  );
}

function SidebarHeader() {
  return (
    <header className="flex items-center px-3 pt-3 pb-2 max-md:justify-center max-md:px-2 max-sm:px-1.5">
      <h1 className="truncate pl-2 font-semibold text-base text-primary max-md:hidden">
        m-dashboard
      </h1>
    </header>
  );
}

function SidebarNavItem({ item }: { item: (typeof navItems)[number] }) {
  const Icon = item.icon;

  return (
    <NavLink
      className={({ isActive }) =>
        `flex h-7 w-full items-center gap-2 rounded-md px-3 text-left text-[13px] font-medium transition-colors ${
          isActive
            ? "bg-primary/12 text-primary shadow-xs ring-1 ring-primary/25"
            : "text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground"
        } max-md:justify-center max-md:px-0 max-sm:h-8`
      }
      to={item.to}
    >
      <Icon className="size-4 shrink-0" />
      <span className="max-md:hidden">{item.label}</span>
    </NavLink>
  );
}

type WorkspaceChatGroup = {
  key: string;
  label: string;
  cwd?: string;
  sessions: ChatIndexItem[];
};

function WorkspaceConversationGroups() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(() => new Set());
  const [serverStatuses, setServerStatuses] = useState<Record<string, ChatServerSession["status"]>>(
    {},
  );
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(loadUnreadChatIds);
  const [serverPort, setServerPort] = useState(14317);
  const [sessionToDelete, setSessionToDelete] = useState<ChatIndexItem | null>(null);
  const chatIndexQuery = useQuery({
    queryKey: ["chat-index"],
    queryFn: loadChatIndex,
  });
  const workspaceProjectsQuery = useQuery({
    queryKey: ["workspace-projects"],
    queryFn: loadWorkspaceProjects,
  });
  const activeSessionId =
    location.pathname === "/chat" ? new URLSearchParams(location.search).get("sessionId") : null;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const groups = useMemo(
    () => groupChatsByWorkspace(chatIndexQuery.data ?? [], workspaceProjectsQuery.data ?? []),
    [chatIndexQuery.data, workspaceProjectsQuery.data],
  );
  const isPending = chatIndexQuery.isPending || workspaceProjectsQuery.isPending;
  const isError = chatIndexQuery.isError || workspaceProjectsQuery.isError;
  const deleteSessionMutation = useMutation({
    mutationFn: (item: ChatIndexItem) => deleteChatSession(item.id),
    onSuccess: async (_, item) => {
      setUnreadSessionIds((current) => {
        if (!current.has(item.id)) return current;
        const next = new Set(current);
        next.delete(item.id);
        saveUnreadChatIds(next);
        return next;
      });
      await queryClient.invalidateQueries({ queryKey: ["chat-index"] });
      if (item.id === activeSessionIdRef.current) {
        const workspaceId = item.workspaceId ?? (item.cwd ? `cwd:${item.cwd}` : "default");
        const params = new URLSearchParams({ workspaceId });
        if (item.cwd) params.set("workspaceCwd", item.cwd);
        navigate(`/chat?${params.toString()}`, { replace: true });
      }
      setSessionToDelete(null);
    },
    onError: (error) => {
      console.error("Failed to delete chat session", error);
    },
  });

  useEffect(() => {
    let active = true;
    void loadChatServerPort().then((port) => {
      if (active) setServerPort(port);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const cleanup = subscribeChatServerEvents(serverPort, {
      onSnapshot: (sessions) => {
        setServerStatuses(
          Object.fromEntries(sessions.map((session) => [session.id, session.status])),
        );
        void queryClient.invalidateQueries({ queryKey: ["chat-index"] });
      },
      onStatus: ({ sessionId, status }) => {
        setServerStatuses((current) => ({ ...current, [sessionId]: status }));
        if (status === "ready") {
          setUnreadSessionIds((current) => {
            const next = new Set(current);
            if (activeSessionIdRef.current === sessionId) next.delete(sessionId);
            else next.add(sessionId);
            saveUnreadChatIds(next);
            return next;
          });
        }
        void queryClient.invalidateQueries({ queryKey: ["chat-index"] });
      },
    });
    return cleanup;
  }, [queryClient, serverPort]);

  function toggleCollapsed(groupKey: string) {
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  function toggleExpanded(groupKey: string) {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  }

  function startWorkspaceSession(group: WorkspaceChatGroup) {
    const params = new URLSearchParams({ workspaceId: group.key });
    if (group.cwd) params.set("workspaceCwd", group.cwd);
    navigate(`/chat?${params.toString()}`);
  }

  function openSession(sessionId: string) {
    setUnreadSessionIds((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      saveUnreadChatIds(next);
      return next;
    });
    navigate(`/chat?sessionId=${encodeURIComponent(sessionId)}`);
  }

  function confirmRemoveSession() {
    if (!sessionToDelete || deleteSessionMutation.isPending) return;
    deleteSessionMutation.mutate(sessionToDelete);
  }

  return (
    <section
      aria-labelledby="workspace-conversations-heading"
      className="px-3 pt-3 pb-2 max-md:hidden"
    >
      <h2
        className="px-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase"
        id="workspace-conversations-heading"
      >
        Workspace
      </h2>
      {isPending ? (
        <WorkspaceConversationSkeleton />
      ) : isError ? (
        <p className="px-2 py-2 text-[12px] text-destructive">对话记录加载失败</p>
      ) : (
        <div className="space-y-1.5">
          {groups.map((group) => {
            const isExpanded = expandedGroups.has(group.key);
            const isCollapsed = collapsedGroups.has(group.key);
            const visibleSessions = isExpanded ? group.sessions : group.sessions.slice(0, 5);
            const hiddenCount = group.sessions.length - 5;

            return (
              <div key={group.key}>
                <div className="flex h-7 items-center gap-1.5">
                  <button
                    aria-expanded={!isCollapsed}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left font-medium text-[13px] text-foreground transition-colors hover:bg-accent/60"
                    onClick={() => toggleCollapsed(group.key)}
                    title={group.label}
                    type="button"
                  >
                    <ChevronDown
                      className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${isCollapsed ? "-rotate-90" : ""}`}
                    />
                    <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{group.label}</span>
                  </button>
                  <button
                    aria-label={`在 ${group.label} 中新建对话`}
                    className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                    onClick={() => startWorkspaceSession(group)}
                    title={`在 ${group.label} 中新建对话`}
                    type="button"
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
                {!isCollapsed ? (
                  group.sessions.length > 0 ? (
                    <div className="space-y-0.5">
                      {visibleSessions.map((session) => {
                        const isActive =
                          location.pathname === "/chat" && activeSessionId === session.id;
                        const sessionStatus = serverStatuses[session.id];
                        const isRunning =
                          sessionStatus === "submitted" || sessionStatus === "streaming";
                        const isUnread = unreadSessionIds.has(session.id);

                        return (
                          <div
                            className={`group flex h-7 w-full items-center rounded-md transition-colors ${
                              isActive
                                ? "bg-accent text-accent-foreground font-medium"
                                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                            }`}
                            key={session.id}
                          >
                            <button
                              aria-current={isActive ? "page" : undefined}
                              className="flex min-w-0 flex-1 items-center rounded-md py-0 pr-1 pl-8 text-left text-[13px]"
                              onClick={() => openSession(session.id)}
                              title={session.title}
                              type="button"
                            >
                              <span className="truncate">{session.title}</span>
                              {isRunning ? (
                                <LoaderCircle
                                  aria-hidden="true"
                                  className="ml-auto size-3.5 shrink-0 animate-spin text-primary"
                                />
                              ) : isUnread ? (
                                <span
                                  className="ml-auto size-1.5 shrink-0 rounded-full bg-primary"
                                  title="未读消息"
                                />
                              ) : null}
                            </button>
                            <button
                              aria-label={`删除${session.title}`}
                              className="mr-1 flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                              disabled={deleteSessionMutation.isPending}
                              onClick={() => setSessionToDelete(session)}
                              title="删除对话"
                              type="button"
                            >
                              <Trash2 className="size-3" />
                            </button>
                          </div>
                        );
                      })}
                      {hiddenCount > 0 ? (
                        <button
                          aria-expanded={isExpanded}
                          className="flex h-7 w-full items-center gap-1 rounded-md pr-2 pl-8 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                          onClick={() => toggleExpanded(group.key)}
                          type="button"
                        >
                          <ChevronDown
                            className={`size-3.5 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                          />
                          <span>{isExpanded ? "收起" : `展开其余 ${hiddenCount} 条`}</span>
                        </button>
                      ) : null}
                    </div>
                  ) : (
                    <p className="px-2 py-1 pl-8 text-[12px] text-muted-foreground">暂无对话</p>
                  )
                ) : null}
              </div>
            );
          })}
        </div>
      )}
      <AlertDialog
        open={sessionToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteSessionMutation.isPending) setSessionToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除对话？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除“{sessionToDelete?.title ?? "这条对话"}”吗？删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteSessionMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteSessionMutation.isPending}
              onClick={confirmRemoveSession}
              variant="destructive"
            >
              {deleteSessionMutation.isPending ? "删除中..." : "删除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function WorkspaceConversationSkeleton() {
  return (
    <div className="space-y-2" role="status" aria-label="正在加载 Workspace 对话记录">
      {[0, 1, 2].map((group) => (
        <div className="space-y-1" key={group}>
          <div className="flex h-7 items-center gap-2 px-2">
            <div className="size-4 animate-pulse rounded bg-muted" />
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
          {[0, 1].map((item) => (
            <div
              className="ml-8 h-7 animate-pulse rounded-md bg-muted/70"
              key={`${group}-${item}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

function groupChatsByWorkspace(
  sessions: ChatIndexItem[],
  projects: Awaited<ReturnType<typeof loadWorkspaceProjects>>,
): WorkspaceChatGroup[] {
  const sessionsByWorkspace = new Map<string, ChatIndexItem[]>();
  const defaultSessions: ChatIndexItem[] = [];
  const projectIdByPath = new Map(projects.map((project) => [project.path, project.id]));

  for (const session of sessions) {
    const workspaceKey =
      session.workspaceId ??
      (session.cwd ? (projectIdByPath.get(session.cwd) ?? `cwd:${session.cwd}`) : undefined);
    if (!workspaceKey) {
      defaultSessions.push(session);
      continue;
    }
    const workspaceSessions = sessionsByWorkspace.get(workspaceKey) ?? [];
    workspaceSessions.push(session);
    sessionsByWorkspace.set(workspaceKey, workspaceSessions);
  }

  const groups: WorkspaceChatGroup[] = [
    { key: "default", label: "Default", sessions: defaultSessions },
  ];

  for (const project of projects) {
    const workspaceSessions = sessionsByWorkspace.get(project.id) ?? [];
    groups.push({
      key: project.id,
      label: pathBasename(project.path),
      cwd: project.path,
      sessions: workspaceSessions,
    });
    sessionsByWorkspace.delete(project.id);
  }

  for (const [workspaceId, workspaceSessions] of sessionsByWorkspace) {
    groups.push({
      key: workspaceId,
      label: pathBasename(workspaceSessions[0]?.cwd ?? "") || "已移除的 Workspace",
      cwd: workspaceSessions[0]?.cwd,
      sessions: workspaceSessions,
    });
  }

  return groups;
}

function pathBasename(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? path
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
