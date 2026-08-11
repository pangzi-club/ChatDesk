import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowDown,
  ArrowUp,
  Brain,
  ChartColumn,
  Check,
  ChevronDown,
  CircleAlert,
  Clock3,
  CornerDownLeft,
  ExternalLink,
  FolderGit2,
  Image,
  KeyRound,
  LayoutDashboard,
  LoaderCircle,
  Lock,
  MessageCircle,
  MoreHorizontal,
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
  Sparkles,
  SquareTerminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  type ComponentType,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { openExternal } from "@/lib/platform";
import { settingsStore } from "@/lib/settings-store";
import { appendSystemLog } from "@/lib/system-log";
import { applyTrayEnabled, loadTrayEnabled } from "@/lib/tray";
import {
  addWorkspaceProject,
  loadWorkspaceProjects,
  selectWorkspaceDirectory,
} from "@/lib/workspaces";

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
  { to: "/settings/tray", label: "托盘", icon: PanelTop, keywords: ["设置", "tray"] },
  {
    to: "/settings/chat-server",
    label: "Chat Server",
    icon: Server,
    keywords: ["设置", "chat", "server", "端口", "localhost", "hono"],
  },
  {
    to: "/settings/statistics",
    label: "使用量",
    icon: ChartColumn,
    keywords: ["设置", "使用量", "usage", "token", "统计", "历史", "归档", "导入"],
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
const WORKSPACE_COLLAPSE_STORAGE_KEY = "m-dashboard-workspace-collapse-v1";
const CHAT_UNREAD_STORE_KEY = "chatUnreadSessionIds";
const WORKSPACE_COLLAPSE_STORE_KEY = "workspaceCollapseState";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

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

async function saveUnreadChatIds(ids: Set<string>) {
  if (isTauri()) {
    await settingsStore.set(CHAT_UNREAD_STORE_KEY, [...ids]);
    await settingsStore.save();
    return;
  }
  window.localStorage.setItem(CHAT_UNREAD_STORAGE_KEY, JSON.stringify([...ids]));
}

function loadWorkspaceCollapseState() {
  if (typeof window === "undefined") return {};
  try {
    const value = JSON.parse(window.localStorage.getItem(WORKSPACE_COLLAPSE_STORAGE_KEY) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        (entry): entry is [string, boolean] =>
          typeof entry[0] === "string" && typeof entry[1] === "boolean",
      ),
    );
  } catch {
    return {};
  }
}

async function saveWorkspaceCollapseState(state: Record<string, boolean>) {
  if (isTauri()) {
    await settingsStore.set(WORKSPACE_COLLAPSE_STORE_KEY, state);
    await settingsStore.save();
    return;
  }
  window.localStorage.setItem(WORKSPACE_COLLAPSE_STORAGE_KEY, JSON.stringify(state));
}

function AppShell() {
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [chatWindowStates, setChatWindowStates] = useState<Record<string, ChatWindowState>>({});
  const location = useLocation();
  const navigate = useNavigate();
  const isChatPage = location.pathname === "/chat";
  const chatWindowKey = getChatWindowKey(location.search);
  const hideMainSidebar =
    location.pathname.startsWith("/settings") || location.pathname.startsWith("/dev-tools/");
  const lockOutletScroll = location.pathname.startsWith("/settings/history");

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
          <div className="app-shell-content relative flex min-w-0 flex-1 flex-col">
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
            <aside className="app-shell-sidebar flex w-[248px] shrink-0 flex-col border-border border-r max-md:w-[72px] max-sm:w-16">
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
            <div className="app-shell-content relative flex min-w-0 flex-1 flex-col max-sm:w-[calc(100vw-4rem)]">
              <div
                className={`chat-split-layout ${isChatPage && chatWindowStates[chatWindowKey]?.open ? "is-open" : ""}`}
              >
                <section
                  className="min-h-0 flex-1 overflow-y-auto"
                  style={
                    isChatPage && chatWindowStates[chatWindowKey]?.open
                      ? {
                          flexBasis: `${(1 - (chatWindowStates[chatWindowKey]?.splitRatio ?? 0.5)) * 100}%`,
                        }
                      : undefined
                  }
                >
                  <Outlet />
                </section>
                {isChatPage && chatWindowStates[chatWindowKey]?.open ? (
                  <>
                    <ChatSplitDivider
                      ratio={chatWindowStates[chatWindowKey]?.splitRatio ?? 0.5}
                      onChange={(splitRatio) =>
                        setChatWindowStates((current) => ({
                          ...current,
                          [chatWindowKey]: {
                            ...(current[chatWindowKey] ?? createChatWindowState()),
                            splitRatio,
                          },
                        }))
                      }
                    />
                    <ChatWorkspaceWindow
                      split
                      state={chatWindowStates[chatWindowKey] ?? createChatWindowState()}
                      onToggle={() =>
                        setChatWindowStates((current) => ({
                          ...current,
                          [chatWindowKey]: {
                            ...(current[chatWindowKey] ?? createChatWindowState()),
                            open: false,
                          },
                        }))
                      }
                      onChange={(next) =>
                        setChatWindowStates((current) => ({ ...current, [chatWindowKey]: next }))
                      }
                    />
                  </>
                ) : null}
              </div>
              <div
                className={`absolute inset-x-0 top-0 z-10 flex h-8 items-center ${isChatPage ? "chat-top-actions-layer" : ""}`}
              >
                <TitlebarDragRegion />
                <TopActions
                  isPanelOpen={isChatPage && Boolean(chatWindowStates[chatWindowKey]?.open)}
                  onTogglePanel={() => {
                    if (!isChatPage) return;
                    setChatWindowStates((current) => {
                      const state = current[chatWindowKey] ?? createChatWindowState();
                      return {
                        ...current,
                        [chatWindowKey]: { ...state, open: !state.open },
                      };
                    });
                  }}
                  showPanelToggle={isChatPage && !chatWindowStates[chatWindowKey]?.open}
                />
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
    <header className="flex items-center px-4 pt-3 pb-2 max-md:justify-center max-md:px-2 max-sm:px-1.5">
      <h1 className="truncate pl-2 font-semibold text-[15px] text-foreground max-md:hidden">
        ChatDesk
      </h1>
    </header>
  );
}

function SidebarNavItem({ item }: { item: (typeof navItems)[number] }) {
  const Icon = item.icon;

  return (
    <NavLink
      className={({ isActive }) =>
        `sidebar-nav-item flex h-8 w-full items-center gap-2 px-3 text-left text-[13px] font-medium transition-colors max-md:justify-center max-md:px-0 max-sm:h-8 ${isActive ? "is-active" : ""}`
      }
      to={item.to}
    >
      {({ isActive }) => (
        <>
          <Icon className="size-4 shrink-0" />
          <span className="max-md:hidden">{item.label}</span>
          <span className="sr-only">{isActive ? "当前页面" : ""}</span>
        </>
      )}
    </NavLink>
  );
}

type WorkspaceChatGroup = {
  key: string;
  label: string;
  cwd?: string;
  sessions: ChatIndexItem[];
};

type WorkspaceSort = "name" | "updated" | "count";

function WorkspaceConversationGroups() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [collapseOverride, setCollapseOverride] = useState<Record<string, boolean>>(
    loadWorkspaceCollapseState,
  );
  const [serverStatuses, setServerStatuses] = useState<Record<string, ChatServerSession["status"]>>(
    {},
  );
  const [unreadSessionIds, setUnreadSessionIds] = useState<Set<string>>(loadUnreadChatIds);
  const [serverPort, setServerPort] = useState(14317);
  const [sessionToDelete, setSessionToDelete] = useState<ChatIndexItem | null>(null);
  const [workspaceSort, setWorkspaceSort] = useState<WorkspaceSort>("updated");
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
    () =>
      groupChatsByWorkspace(
        chatIndexQuery.data ?? [],
        sortWorkspaceProjects(
          workspaceProjectsQuery.data ?? [],
          chatIndexQuery.data ?? [],
          workspaceSort,
        ),
      ),
    [chatIndexQuery.data, workspaceProjectsQuery.data, workspaceSort],
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
        void saveUnreadChatIds(next).catch((error) =>
          console.error("Failed to save unread chat state", error),
        );
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
  const addWorkspaceMutation = useMutation({
    mutationFn: async () => {
      const path = await selectWorkspaceDirectory();
      return path ? addWorkspaceProject(path) : null;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-projects"] }),
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
    if (!isTauri()) return;
    void Promise.all([
      settingsStore.get<unknown>(CHAT_UNREAD_STORE_KEY),
      settingsStore.get<unknown>(WORKSPACE_COLLAPSE_STORE_KEY),
    ])
      .then(([unread, collapse]) => {
        if (Array.isArray(unread)) {
          setUnreadSessionIds(new Set(unread.filter((id): id is string => typeof id === "string")));
        }
        if (collapse && typeof collapse === "object" && !Array.isArray(collapse)) {
          setCollapseOverride(
            Object.fromEntries(
              Object.entries(collapse).filter(
                (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
              ),
            ),
          );
        }
      })
      .catch((error) => console.error("Failed to load desktop navigation state", error));
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
            void saveUnreadChatIds(next).catch((error) =>
              console.error("Failed to save unread chat state", error),
            );
            return next;
          });
        }
        void queryClient.invalidateQueries({ queryKey: ["chat-index"] });
      },
    });
    return cleanup;
  }, [queryClient, serverPort]);

  function isGroupCollapsed(group: WorkspaceChatGroup) {
    if (group.key in collapseOverride) return collapseOverride[group.key];
    return group.sessions.length === 0;
  }

  function toggleCollapsed(group: WorkspaceChatGroup) {
    const nextCollapsed = !isGroupCollapsed(group);
    setCollapseOverride((current) => {
      const next = { ...current, [group.key]: nextCollapsed };
      void saveWorkspaceCollapseState(next).catch((error) =>
        console.error("Failed to save workspace collapse state", error),
      );
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

  function addWorkspace() {
    if (!addWorkspaceMutation.isPending) void addWorkspaceMutation.mutateAsync();
  }

  function openSession(sessionId: string) {
    setUnreadSessionIds((current) => {
      if (!current.has(sessionId)) return current;
      const next = new Set(current);
      next.delete(sessionId);
      void saveUnreadChatIds(next).catch((error) =>
        console.error("Failed to save unread chat state", error),
      );
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
      <div className="group flex h-7 items-center rounded-md px-2 transition-colors hover:bg-accent/60">
        <h2
          className="min-w-0 flex-1 truncate font-medium text-xs text-muted-foreground uppercase"
          id="workspace-conversations-heading"
        >
          Workspace
        </h2>
        <button
          aria-label="添加 Workspace"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
          disabled={addWorkspaceMutation.isPending}
          onClick={addWorkspace}
          title="添加 Workspace"
          type="button"
        >
          <Plus className="size-3.5" />
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label="Workspace 排序"
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
              title="Workspace 排序"
              type="button"
            >
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6}>
            <DropdownMenuLabel>排序方式</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setWorkspaceSort("name")}>
              <span className="flex-1">按名称</span>
              {workspaceSort === "name" ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setWorkspaceSort("updated")}>
              <span className="flex-1">按更新</span>
              {workspaceSort === "updated" ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setWorkspaceSort("count")}>
              <span className="flex-1">按对话数量</span>
              {workspaceSort === "count" ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {addWorkspaceMutation.error ? (
        <p className="px-2 py-1 text-[11px] text-destructive">
          {describeError(addWorkspaceMutation.error)}
        </p>
      ) : null}
      {isPending ? (
        <WorkspaceConversationSkeleton />
      ) : isError ? (
        <p className="px-2 py-2 text-[12px] text-destructive">对话记录加载失败</p>
      ) : (
        <div className="space-y-1.5">
          {groups.map((group) => {
            const isExpanded = expandedGroups.has(group.key);
            const isCollapsed = isGroupCollapsed(group);
            const visibleSessions = isExpanded ? group.sessions : group.sessions.slice(0, 5);
            const hiddenCount = group.sessions.length - 5;

            return (
              <div key={group.key}>
                <div className="group flex h-7 min-w-0 items-center rounded-md transition-colors hover:bg-accent/60">
                  <button
                    aria-expanded={!isCollapsed}
                    aria-label={isCollapsed ? `展开 ${group.label}` : `收起 ${group.label}`}
                    className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 text-left font-medium text-[13px] text-foreground"
                    onClick={() => toggleCollapsed(group)}
                    title={group.label}
                    type="button"
                  >
                    <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate">{group.label}</span>
                  </button>
                  <button
                    aria-label={`在 ${group.label} 中新建对话`}
                    className="mr-0.5 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100"
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
                              className={`flex min-w-0 flex-1 items-center rounded-md py-0 pr-1 pl-8 text-left font-medium text-[13px] ${isActive ? "text-accent-foreground" : "text-foreground"}`}
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
    <div className="space-y-1.5" role="status" aria-label="正在加载 Workspace 对话记录">
      {[0, 1, 2].map((group) => (
        <div className="flex h-7 items-center gap-2 px-2" key={group}>
          <div className="size-4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function sortWorkspaceProjects(
  projects: Awaited<ReturnType<typeof loadWorkspaceProjects>>,
  sessions: ChatIndexItem[],
  sort: WorkspaceSort,
) {
  const latestSessionByWorkspace = new Map<string, string>();
  const sessionCountByWorkspace = new Map<string, number>();
  for (const session of sessions) {
    if (!session.workspaceId) continue;
    sessionCountByWorkspace.set(
      session.workspaceId,
      (sessionCountByWorkspace.get(session.workspaceId) ?? 0) + 1,
    );
    const current = latestSessionByWorkspace.get(session.workspaceId);
    if (!current || session.updatedAt > current) {
      latestSessionByWorkspace.set(session.workspaceId, session.updatedAt);
    }
  }

  return [...projects].sort((a, b) => {
    if (sort === "name") {
      return pathBasename(a.path).localeCompare(pathBasename(b.path), undefined, {
        sensitivity: "base",
      });
    }
    if (sort === "count") {
      const countDifference =
        (sessionCountByWorkspace.get(b.id) ?? 0) - (sessionCountByWorkspace.get(a.id) ?? 0);
      if (countDifference !== 0) return countDifference;
      return pathBasename(a.path).localeCompare(pathBasename(b.path), undefined, {
        sensitivity: "base",
      });
    }
    const aUpdated = latestSessionByWorkspace.get(a.id) ?? a.createdAt;
    const bUpdated = latestSessionByWorkspace.get(b.id) ?? b.createdAt;
    return bUpdated.localeCompare(aUpdated);
  });
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

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type ChatWindowTab = { id: string; title: string };
type ChatWindowState = {
  open: boolean;
  tabs: ChatWindowTab[];
  activeTabId: string | null;
  right: number;
  top: number;
  width: number;
  height: number;
  splitRatio: number;
};

type WindowInteraction = {
  direction: ResizeDirection | "move";
  startX: number;
  startY: number;
  initial: Pick<ChatWindowState, "right" | "top" | "width" | "height">;
};

type ResizeDirection = "n" | "e" | "s" | "w" | "ne" | "se" | "sw" | "nw";

function createChatWindowState(): ChatWindowState {
  const firstTab = { id: createChatWindowTabId(), title: "空白窗口" };
  return {
    open: false,
    tabs: [firstTab],
    activeTabId: firstTab.id,
    right: 18,
    top: 48,
    width: 420,
    height: 360,
    splitRatio: 0.5,
  };
}

function createChatWindowTabId() {
  return `chat-window-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getChatWindowKey(search: string) {
  const params = new URLSearchParams(search);
  return params.get("sessionId") || `workspace:${params.get("workspaceId") || "new"}`;
}

function ChatWorkspaceWindow({
  onChange,
  onToggle,
  split = false,
  state,
}: {
  onChange: (state: ChatWindowState) => void;
  onToggle: () => void;
  split?: boolean;
  state: ChatWindowState;
}) {
  const interactionRef = useRef<WindowInteraction | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  function beginInteraction(event: ReactPointerEvent, direction: ResizeDirection | "move") {
    event.preventDefault();
    event.stopPropagation();
    interactionRef.current = {
      direction,
      startX: event.clientX,
      startY: event.clientY,
      initial: {
        right: state.right,
        top: state.top,
        width: state.width,
        height: state.height,
      },
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const interaction = interactionRef.current;
      if (!interaction) return;
      const dx = moveEvent.clientX - interaction.startX;
      const dy = moveEvent.clientY - interaction.startY;
      const bounds = containerRef.current?.parentElement?.getBoundingClientRect();
      const maxWidth = Math.max(280, (bounds?.width ?? window.innerWidth) - 24);
      const maxHeight = Math.max(220, (bounds?.height ?? window.innerHeight) - 36);
      const minWidth = 280;
      const minHeight = 220;
      const initial = interaction.initial;
      const next = { ...initial };

      if (interaction.direction === "move") {
        next.right = clamp(
          initial.right - dx,
          0,
          Math.max(0, (bounds?.width ?? window.innerWidth) - initial.width),
        );
        next.top = clamp(
          initial.top + dy,
          32,
          Math.max(32, (bounds?.height ?? window.innerHeight) - initial.height),
        );
      } else {
        if (interaction.direction.includes("e"))
          next.width = clamp(initial.width + dx, minWidth, maxWidth);
        if (interaction.direction.includes("w")) {
          next.width = clamp(initial.width - dx, minWidth, maxWidth);
          next.right = initial.right + initial.width - next.width;
        }
        if (interaction.direction.includes("s"))
          next.height = clamp(initial.height + dy, minHeight, maxHeight);
        if (interaction.direction.includes("n")) {
          next.height = clamp(initial.height - dy, minHeight, maxHeight);
          next.top = Math.max(32, initial.top + initial.height - next.height);
        }
      }
      onChange({ ...state, ...next });
    };

    const handleUp = () => {
      interactionRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function addTab() {
    const nextTab = {
      id: createChatWindowTabId(),
      title: `空白窗口 ${state.tabs.length + 1}`,
    };
    onChange({ ...state, tabs: [...state.tabs, nextTab], activeTabId: nextTab.id });
  }

  function closeTab(tabId: string) {
    const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
    const nextActive =
      state.activeTabId === tabId
        ? (nextTabs[Math.max(0, state.tabs.findIndex((tab) => tab.id === tabId) - 1)]?.id ??
          nextTabs[0]?.id ??
          null)
        : state.activeTabId;
    onChange({ ...state, tabs: nextTabs, activeTabId: nextActive });
  }

  return (
    <div
      className={`chat-workspace-window ${split ? "is-split" : ""}`}
      ref={containerRef}
      style={
        split
          ? { flexBasis: `${state.splitRatio * 100}%` }
          : { height: state.height, right: state.right, top: state.top, width: state.width }
      }
    >
      <div
        className="chat-workspace-window-tabs"
        onPointerDown={split ? undefined : (event) => beginInteraction(event, "move")}
        role="toolbar"
        aria-label="Chat 独立窗口"
      >
        <div className="chat-workspace-window-tab-list">
          {state.tabs.map((tab) => (
            <div
              className={`chat-workspace-window-tab ${tab.id === state.activeTabId ? "is-active" : ""}`}
              key={tab.id}
            >
              <button
                className="chat-workspace-window-tab-select"
                onClick={() => onChange({ ...state, activeTabId: tab.id })}
                type="button"
              >
                {tab.title}
              </button>
              <button
                aria-label={`关闭${tab.title}`}
                className="chat-workspace-window-tab-close"
                onClick={() => closeTab(tab.id)}
                type="button"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
        <Button
          aria-label="新建独立窗口"
          className="chat-workspace-window-add"
          onClick={addTab}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Plus className="size-3.5" />
        </Button>
        <Button
          aria-label="关闭 Chat 独立窗口"
          className="chat-workspace-window-toggle"
          onClick={onToggle}
          size="icon"
          type="button"
          variant="ghost"
        >
          <PanelLeft className="size-3.5 rotate-180" />
        </Button>
      </div>
      <div className="chat-workspace-window-empty" aria-live="polite">
        {state.tabs.length === 0 ? "窗口为空" : "空白占位窗口"}
      </div>
      {!split
        ? (["n", "e", "s", "w", "ne", "se", "sw", "nw"] as ResizeDirection[]).map((direction) => (
            <div
              aria-hidden="true"
              className={`chat-workspace-window-resize chat-workspace-window-resize-${direction}`}
              key={direction}
              onPointerDown={(event) => beginInteraction(event, direction)}
            />
          ))
        : null}
    </div>
  );
}

function ChatSplitDivider({
  onChange,
  ratio,
}: {
  onChange: (ratio: number) => void;
  ratio: number;
}) {
  function startResize(event: ReactPointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const parent = event.currentTarget.parentElement;
    const width = parent?.getBoundingClientRect().width ?? window.innerWidth;
    const handleMove = (moveEvent: PointerEvent) => {
      onChange(clamp(ratio - (moveEvent.clientX - startX) / width, 0.25, 0.75));
    };
    const handleUp = () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  return <div aria-hidden="true" className="chat-split-divider" onPointerDown={startResize} />;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function TopActions({
  isPanelOpen,
  onTogglePanel,
  showPanelToggle,
}: {
  isPanelOpen: boolean;
  onTogglePanel: () => void;
  showPanelToggle: boolean;
}) {
  return (
    <div className="top-actions flex items-center gap-1.5 pr-3 text-muted-foreground max-sm:gap-0.5 max-sm:px-2">
      {showPanelToggle ? (
        <Button
          aria-label={isPanelOpen ? "关闭 Chat 独立窗口" : "打开 Chat 独立窗口"}
          aria-pressed={isPanelOpen}
          className="size-8"
          onClick={onTogglePanel}
          size="icon"
          type="button"
          variant="ghost"
        >
          <PanelLeft
            className={`size-4 rotate-180 transition-transform ${isPanelOpen ? "scale-x-[-1]" : ""}`}
          />
        </Button>
      ) : null}
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
      await openExternal(searchUrl);
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
