import {
  DEFAULT_WORKSPACE_ID,
  type WorkspaceFileEntry,
  type WorkspaceGitFile,
} from "@chatdesk/shared";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Bell,
  Brain,
  ChartColumn,
  Check,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  CopyX,
  CornerDownLeft,
  FolderGit2,
  Globe2,
  Image,
  Keyboard,
  KeyRound,
  LoaderCircle,
  Maximize2,
  MessageCircle,
  Minimize2,
  MoreHorizontal,
  Package,
  Palette,
  PanelLeft,
  Play,
  PlugZap,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Trash2,
  Undo2,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  type ComponentType,
  type CSSProperties,
  type KeyboardEvent,
  type DragEvent as ReactDragEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NavLink,
  type NavLinkRenderProps,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { ChatBrowser } from "@/components/chat-browser";
import { ChatConversationHoverCard } from "@/components/chat-conversation-hover-card";
import {
  ChatConversationMenuItems,
  copyChatConversationId,
} from "@/components/chat-conversation-menu-items";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ChatTerminal } from "@/components/chat-terminal";
import { ExplorerFileIcon } from "@/components/explorer-file-icon";
import { FileViewer } from "@/components/file-viewer";
import { GitCommitDialog } from "@/components/git-commit-dialog";
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
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  type BrowserNavigationState,
  getBrowserNavigationState,
  getBrowserPreviewTitle,
  moveBrowserNavigation,
  normalizeBrowserPreviewUrl,
  pushBrowserNavigation,
} from "@/lib/browser-preview";
import { openBrowserPreview, subscribeBrowserPreviewOpen } from "@/lib/browser-preview-events";
import { copyChatConversationMarkdown } from "@/lib/chat-conversation-markdown";
import {
  chatNewNavigationState,
  chatNewPath,
  chatSessionPath,
  getChatWindowKey,
  isChatPath,
  parseChatLocation,
} from "@/lib/chat-routes";
import {
  type ChatServerSession,
  canMonitorChatServer,
  canRestartChatServer,
  getChatServerStatus,
  loadChatPlan,
  loadChatPlans,
  loadChatServerPort,
  loadServerWorkspaceFile,
  loadServerWorkspaceFiles,
  loadServerWorkspaceGit,
  loadServerWorkspaceGitDiff,
  regenerateChatSessionTitle,
  restartChatServer,
  restoreServerWorkspaceGit,
  subscribeChatServerEvents,
} from "@/lib/chat-server";
import {
  type ChatIndexItem,
  deleteChatSession,
  loadChatIndex,
  loadChatSession,
  searchChatIndex,
} from "@/lib/chat-store";
import { getDesktopBridge, isDesktop } from "@/lib/desktop-bridge";
import { explorerFileIconKind } from "@/lib/explorer-file-icon";
import { subscribeFileViewerOpen } from "@/lib/file-viewer-events";
import { subscribeImagePreviewOpen } from "@/lib/image-preview-events";
import {
  requestPlanExecution,
  subscribePlanViewerOpen,
  subscribePlanViewerUpdated,
} from "@/lib/plan-viewer-events";
import { settingsStore } from "@/lib/settings-store";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  loadShortcutSettings,
  matchesShortcut,
  type ShortcutSettings,
  subscribeShortcutSettings,
} from "@/lib/shortcuts";
import { appendSystemLog } from "@/lib/system-log";
import { terminalSessions } from "@/lib/terminal";
import {
  getWorkspaceSessionKey,
  sortWorkspaceConversationGroups,
  sortWorkspaceProjects,
  type WorkspaceSort,
} from "@/lib/workspace-conversation-utils";
import { isDefaultWorkspaceId, resolveDefaultSessionCwd } from "@/lib/workspace-path";
import {
  addWorkspaceProject,
  loadWorkspaceProjects,
  removeWorkspaceProject,
  selectWorkspaceDirectory,
  type WorkspaceGitInfo,
  type WorkspaceProject,
  workspaceGitQueryKey,
} from "@/lib/workspaces";

const navItems = [
  { to: "/chat", label: "Chat", icon: MessageCircle },
  { to: "/image-generation", label: "Image", icon: Image },
  { to: "/automations", label: "Automations", icon: Clock3 },
] satisfies Array<{
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}>;

const WORKBENCH_MOTION_TRANSITION = { duration: 0.16, ease: "easeOut" } as const;
const WORKBENCH_LAYOUT_TRANSITION = { duration: 0.18, ease: "easeOut" } as const;
const REDUCED_MOTION_TRANSITION = { duration: 0 } as const;

function getWorkbenchMotionTransition(shouldReduceMotion: boolean) {
  return shouldReduceMotion ? REDUCED_MOTION_TRANSITION : WORKBENCH_MOTION_TRANSITION;
}

function getWorkbenchLayoutTransition(shouldReduceMotion: boolean) {
  return shouldReduceMotion ? REDUCED_MOTION_TRANSITION : WORKBENCH_LAYOUT_TRANSITION;
}

const commandItems = [
  { to: "/chat", label: "Chat", icon: MessageCircle, keywords: ["对话", "聊天"] },
  { to: "/automations", label: "Automations", icon: Clock3, keywords: ["自动化", "任务"] },
  {
    to: "/image-generation",
    label: "Image",
    icon: Image,
    keywords: ["图片", "生成", "image"],
  },
  { to: "/settings", label: "Settings", icon: Settings, keywords: ["设置"] },
  {
    to: "/settings/general",
    label: "常规",
    icon: Bell,
    keywords: ["设置", "常规", "通知", "系统通知", "对话完成"],
  },
  {
    to: "/settings/theme",
    label: "主题",
    icon: Palette,
    keywords: ["theme", "外观", "配色", "颜色", "灰白", "字体", "中文", "英文", "代码", "数学"],
  },
  {
    to: "/settings/shortcuts",
    label: "快捷键",
    icon: Keyboard,
    keywords: ["设置", "快捷键", "shortcut", "hotkey", "键盘"],
  },
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
    keywords: ["设置", "skills", "skill", "技能", "提示词", "工作流", "agents"],
  },
  {
    to: "/settings/tools",
    label: "Tools",
    icon: Wrench,
    keywords: ["设置", "tools", "工具", "工具包", "chat tools"],
  },
  {
    to: "/settings/sandbox",
    label: "沙箱",
    icon: ShieldCheck,
    keywords: ["设置", "sandbox", "沙箱", "读取白名单", "目录权限"],
  },
  {
    to: "/settings/environment",
    label: "环境",
    icon: SquareTerminal,
    keywords: ["设置", "环境", "environment", "path", "node", "pnpm", "python", "go"],
  },
  {
    to: "/settings/memory",
    label: "长期记忆",
    icon: Brain,
    keywords: ["设置", "memory", "记忆", "长期记忆"],
  },
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
const WORKSPACE_SORT_STORAGE_KEY = "m-dashboard-workspace-sort-v1";
const CHAT_UNREAD_STORE_KEY = "chatUnreadSessionIds";
const WORKSPACE_COLLAPSE_STORE_KEY = "workspaceCollapseState";
const WORKSPACE_SORT_STORE_KEY = "workspaceSort";
const WORKSPACE_SECTION_COLLAPSE_KEY = "__workspace_section__";
const MAIN_SIDEBAR_STATE_STORAGE_KEY = "m-dashboard-main-sidebar-v1";
const MAIN_SIDEBAR_STATE_STORE_KEY = "mainSidebarState";
const MAIN_SIDEBAR_DEFAULT_WIDTH = 248;
const MAIN_SIDEBAR_MIN_WIDTH = 200;
const MAIN_SIDEBAR_MAX_WIDTH = 360;

type MainSidebarState = {
  width: number;
  collapsed: boolean;
};

function normalizeMainSidebarState(value: unknown): MainSidebarState {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const width =
    typeof record.width === "number" && Number.isFinite(record.width)
      ? clamp(record.width, MAIN_SIDEBAR_MIN_WIDTH, MAIN_SIDEBAR_MAX_WIDTH)
      : MAIN_SIDEBAR_DEFAULT_WIDTH;
  return { width, collapsed: record.collapsed === true };
}

function loadMainSidebarState() {
  if (typeof window === "undefined") return normalizeMainSidebarState(null);
  try {
    return normalizeMainSidebarState(
      JSON.parse(window.localStorage.getItem(MAIN_SIDEBAR_STATE_STORAGE_KEY) ?? "null"),
    );
  } catch {
    return normalizeMainSidebarState(null);
  }
}

async function saveMainSidebarState(state: MainSidebarState) {
  if (isDesktop()) {
    await settingsStore.set(MAIN_SIDEBAR_STATE_STORE_KEY, state);
    await settingsStore.save();
    return;
  }
  window.localStorage.setItem(MAIN_SIDEBAR_STATE_STORAGE_KEY, JSON.stringify(state));
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
  if (isDesktop()) {
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
  if (isDesktop()) {
    await settingsStore.set(WORKSPACE_COLLAPSE_STORE_KEY, state);
    await settingsStore.save();
    return;
  }
  window.localStorage.setItem(WORKSPACE_COLLAPSE_STORAGE_KEY, JSON.stringify(state));
}

function isWorkspaceSort(value: unknown): value is WorkspaceSort {
  return value === "name" || value === "updated" || value === "count";
}

function loadWorkspaceSort() {
  if (typeof window === "undefined") return "updated" as WorkspaceSort;
  const stored = window.localStorage.getItem(WORKSPACE_SORT_STORAGE_KEY);
  return isWorkspaceSort(stored) ? stored : "updated";
}

async function saveWorkspaceSort(sort: WorkspaceSort) {
  if (isDesktop()) {
    await settingsStore.set(WORKSPACE_SORT_STORE_KEY, sort);
    await settingsStore.save();
    window.localStorage.removeItem(WORKSPACE_SORT_STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(WORKSPACE_SORT_STORAGE_KEY, sort);
}

function persistWorkspaceSort(sort: WorkspaceSort) {
  void saveWorkspaceSort(sort).catch((error) =>
    console.error("Failed to save workspace sort state", error),
  );
}

function AppShell() {
  const [isCommandMenuOpen, setIsCommandMenuOpen] = useState(false);
  const [isChatSearchOpen, setIsChatSearchOpen] = useState(false);
  const [chatWindowStates, setChatWindowStates] = useState<Record<string, ChatWindowState>>({});
  const [shortcutSettings, setShortcutSettings] = useState<ShortcutSettings>(DEFAULT_SHORTCUTS);
  const [mainSidebarState, setMainSidebarState] = useState(loadMainSidebarState);
  const mainSidebarRef = useRef<HTMLElement>(null);
  const mainSidebarWidthRef = useRef(mainSidebarState.width);
  const location = useLocation();
  const navigate = useNavigate();
  const isChatPage = isChatPath(location.pathname);
  const chatWindowKey = getChatWindowKey(location.pathname, location.search);
  const previousChatWindowKeyRef = useRef(chatWindowKey);
  const activeChatWindowState = chatWindowStates[chatWindowKey];
  const isChatPanelOpen = isChatPage && Boolean(activeChatWindowState?.open);
  const isChatPanelExpanded = isChatPage && Boolean(activeChatWindowState?.expanded);
  const chatPanelSplitRatio = activeChatWindowState?.splitRatio ?? 0.5;
  const shouldReduceMotion = Boolean(useReducedMotion());
  const chatPanelTransition = getWorkbenchLayoutTransition(shouldReduceMotion);
  const chatRoute = useMemo(
    () => parseChatLocation(location.pathname, location.search),
    [location.pathname, location.search],
  );
  const chatSessionId = chatRoute.kind === "session" ? chatRoute.sessionId : null;
  const chatSessionQuery = useQuery({
    queryKey: ["chat-window-session", chatSessionId],
    queryFn: () => loadChatSession(chatSessionId ?? ""),
    enabled: Boolean(chatSessionId),
  });
  const workspaceProjectsQuery = useQuery({
    queryKey: ["workspace-projects"],
    queryFn: loadWorkspaceProjects,
  });
  const chatWorkspaceId =
    chatRoute.kind === "new"
      ? chatRoute.workspaceId || DEFAULT_WORKSPACE_ID
      : (chatSessionQuery.data?.workspaceId ?? "");
  const defaultTasksRoot = workspaceProjectsQuery.data?.find(
    (project) => project.id === DEFAULT_WORKSPACE_ID,
  )?.path;
  const chatWorkspaceCwd =
    chatRoute.kind === "new"
      ? chatRoute.workspaceId
        ? chatRoute.workspaceCwd
        : resolveDefaultSessionCwd(defaultTasksRoot, "", chatRoute.workspaceCwd)
      : chatSessionQuery.data
        ? isDefaultWorkspaceId(chatSessionQuery.data.workspaceId)
          ? resolveDefaultSessionCwd(
              defaultTasksRoot,
              chatSessionQuery.data.id,
              chatSessionQuery.data.cwd,
            )
          : (chatSessionQuery.data.cwd ?? "")
        : "";
  const hideMainSidebar = location.pathname.startsWith("/settings");
  const lockOutletScroll = location.pathname.startsWith("/settings/history");

  useEffect(() => {
    rememberReturnPath(location.pathname, location.search);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const previousKey = previousChatWindowKeyRef.current;
    previousChatWindowKeyRef.current = chatWindowKey;
    if (
      previousKey === chatWindowKey ||
      !previousKey.startsWith("workspace:") ||
      chatWindowKey.startsWith("workspace:")
    ) {
      return;
    }
    setChatWindowStates((current) => {
      const draftState = current[previousKey];
      if (!draftState) return current;
      const next = { ...current };
      delete next[previousKey];
      next[chatWindowKey] = current[chatWindowKey] ?? draftState;
      return next;
    });
  }, [chatWindowKey]);

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    void settingsStore
      .get<unknown>(MAIN_SIDEBAR_STATE_STORE_KEY)
      .then((value) => {
        if (!active || value === null || value === undefined) return;
        const next = normalizeMainSidebarState(value);
        mainSidebarWidthRef.current = next.width;
        setMainSidebarState(next);
      })
      .catch((error) => console.error("Failed to load main sidebar state", error));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void appendSystemLog({ level: "info", source: "应用", message: "应用窗口已启动" }).catch(() => {
      // Logging must never prevent the app from rendering.
    });
  }, []);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return;

    let active = true;
    const unlisteners: Array<() => void> = [];
    const listen = (event: string, listener: (payload: unknown) => void) => {
      void bridge.subscribe(event, listener).then((cleanup) => {
        if (!active) cleanup();
        else unlisteners.push(cleanup);
      });
    };
    const openTrayPath = (path: string) => {
      navigate(path === "/chat" ? chatNewPath() : path);
    };
    listen("tray-chat", () => openTrayPath("/chat"));
    listen("tray-open", (payload) => {
      if (!payload || typeof payload !== "object") return;
      const path = (payload as { path?: unknown }).path;
      if (typeof path === "string" && path.startsWith("/")) openTrayPath(path);
    });

    return () => {
      active = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [navigate]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (bridge?.runtime !== "electron") return;

    let active = true;
    const unlisteners: Array<() => void> = [];
    const subscribe = (event: string, listener: (payload: Record<string, unknown>) => void) => {
      void bridge
        .subscribe(event, (payload) => {
          if (payload && typeof payload === "object") {
            listener(payload as Record<string, unknown>);
          }
        })
        .then((cleanup) => {
          if (active) unlisteners.push(cleanup);
          else cleanup();
        });
    };

    subscribe("browser-preview-open", (payload) => {
      if (typeof payload.url === "string") {
        openBrowserPreview({ newTab: true, url: payload.url });
      }
    });
    subscribe("browser-frame-navigate", (payload) => {
      if (typeof payload.url === "string" && typeof payload.frameName === "string") {
        openBrowserPreview({
          frameName: payload.frameName,
          source: "frame",
          url: payload.url,
        });
      }
    });

    return () => {
      active = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void loadShortcutSettings().then((value) => {
      if (active) setShortcutSettings(value);
    });
    const unsubscribe = subscribeShortcutSettings(() => {
      void loadShortcutSettings().then((value) => {
        if (active) setShortcutSettings(value);
      });
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    function handleGlobalShortcut(event: globalThis.KeyboardEvent) {
      const isTerminalInput =
        event.target instanceof Element && Boolean(event.target.closest(".chat-terminal"));
      if (isTerminalInput && !event.metaKey) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setIsChatSearchOpen(false);
        setIsCommandMenuOpen((isOpen) => !isOpen);
        return;
      }
      if (!isChatPage) return;
      if (matchesShortcut(event, shortcutSettings.chatSidebar)) {
        event.preventDefault();
        setChatWindowStates((current) => {
          const state = current[chatWindowKey] ?? createChatWindowState();
          const open = !state.open;
          return {
            ...current,
            [chatWindowKey]: { ...state, open, expanded: open ? state.expanded : false },
          };
        });
        return;
      }
      if (matchesShortcut(event, shortcutSettings.chatSidebarMaximize)) {
        event.preventDefault();
        setChatWindowStates((current) => {
          const state = current[chatWindowKey] ?? createChatWindowState();
          return {
            ...current,
            [chatWindowKey]: {
              ...state,
              open: true,
              expanded: state.open ? !state.expanded : true,
            },
          };
        });
      }
    }

    window.addEventListener("keydown", handleGlobalShortcut);
    return () => window.removeEventListener("keydown", handleGlobalShortcut);
  }, [chatWindowKey, isChatPage, shortcutSettings]);

  function persistMainSidebarState(state: MainSidebarState) {
    void saveMainSidebarState(state).catch((error) =>
      console.error("Failed to save main sidebar state", error),
    );
  }

  function toggleMainSidebar() {
    setMainSidebarState((current) => {
      const next = { ...current, collapsed: !current.collapsed };
      persistMainSidebarState(next);
      return next;
    });
  }

  function setMainSidebarWidth(width: number) {
    const nextWidth = clamp(width, MAIN_SIDEBAR_MIN_WIDTH, MAIN_SIDEBAR_MAX_WIDTH);
    mainSidebarWidthRef.current = nextWidth;
    setMainSidebarState((current) => {
      const next = { ...current, width: nextWidth };
      persistMainSidebarState(next);
      return next;
    });
  }

  function beginMainSidebarResize(event: ReactPointerEvent) {
    if (window.matchMedia("(max-width: 767px)").matches) return;
    event.preventDefault();
    const startX = event.clientX;
    const initialWidth = mainSidebarRef.current?.getBoundingClientRect().width;
    if (!initialWidth) return;
    mainSidebarWidthRef.current = initialWidth;

    const handleMove = (moveEvent: PointerEvent) => {
      const width = clamp(
        initialWidth + moveEvent.clientX - startX,
        MAIN_SIDEBAR_MIN_WIDTH,
        MAIN_SIDEBAR_MAX_WIDTH,
      );
      mainSidebarWidthRef.current = width;
      mainSidebarRef.current?.style.setProperty("--main-sidebar-width", `${width}px`);
    };
    const handleUp = () => {
      setMainSidebarWidth(mainSidebarWidthRef.current);
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  function handleMainSidebarResizeKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home") return;
    event.preventDefault();
    const width =
      event.key === "Home"
        ? MAIN_SIDEBAR_DEFAULT_WIDTH
        : mainSidebarState.width + (event.key === "ArrowLeft" ? -8 : 8);
    setMainSidebarWidth(width);
  }

  useEffect(() => {
    return subscribeFileViewerOpen((request) => {
      const key = getChatWindowKey(location.pathname, location.search);
      setChatWindowStates((current) => {
        const state = current[key] ?? createChatWindowState();
        const existing = state.tabs.find(
          (tab) =>
            (tab.kind === "workspace" || tab.kind === "source" || tab.kind === "git-diff") &&
            tab.workspaceId === request.workspaceId,
        );
        const tab: ChatWindowTab = existing ?? {
          id: createChatWindowTabId(),
          title: "Explorer",
          kind: "workspace" as const,
          workspaceId: request.workspaceId,
          cwd: request.cwd,
          path: request.path,
          content: request.content,
          refreshToken: Date.now(),
          explorerView: request.mode === "diff" ? ("git" as const) : ("files" as const),
          editorMode: request.mode,
        };
        const refreshedTab: ChatWindowTab = existing
          ? {
              ...existing,
              kind: "workspace" as const,
              refreshToken: Date.now(),
              path: request.path,
              content: request.content,
              cwd: request.cwd ?? existing.cwd,
              explorerView: request.mode === "diff" ? ("git" as const) : ("files" as const),
              editorMode: request.mode,
            }
          : tab;
        return {
          ...current,
          [key]: {
            ...state,
            open: true,
            tabs: existing
              ? state.tabs.map((item) => (item.id === existing.id ? refreshedTab : item))
              : [...state.tabs, tab],
            activeTabId: refreshedTab.id,
          },
        };
      });
    });
  }, [location.pathname, location.search]);

  useEffect(() => {
    return subscribePlanViewerUpdated((request) => {
      setChatWindowStates((current) => {
        const next = { ...current };
        for (const [key, state] of Object.entries(current)) {
          const tabs = state.tabs.map((tab) =>
            tab.kind === "plan" && tab.sessionId === request.sessionId
              ? {
                  ...tab,
                  ...(tab.planId === request.planId
                    ? {
                        title: request.fileName,
                        content: request.content ?? tab.content,
                        canExecute: request.canExecute ?? tab.canExecute,
                      }
                    : { canExecute: false }),
                  activePlanId: request.planId,
                  activePlanCanExecute: request.canExecute ?? tab.activePlanCanExecute,
                }
              : tab,
          );
          if (tabs.some((tab, index) => tab !== state.tabs[index])) {
            next[key] = { ...state, tabs };
          }
        }
        return next;
      });
    });
  }, []);

  useEffect(() => {
    return subscribePlanViewerOpen((request) => {
      const key = getChatWindowKey(location.pathname, location.search);
      setChatWindowStates((current) => {
        const state = current[key] ?? createChatWindowState();
        const existing = state.tabs.find(
          (tab) => tab.kind === "plan" && tab.sessionId === request.sessionId,
        );
        const tab: ChatWindowTab = existing ?? {
          id: createChatWindowTabId(),
          title: request.fileName,
          kind: "plan",
          sessionId: request.sessionId,
          planId: request.planId,
          content: request.content,
          canExecute: request.canExecute,
          activePlanId: request.planId,
          activePlanCanExecute: request.canExecute,
        };
        const updated = {
          ...tab,
          title: request.fileName,
          planId: request.planId,
          content: request.content,
          canExecute: request.canExecute,
          activePlanId: request.planId,
          activePlanCanExecute: request.canExecute,
        };
        return {
          ...current,
          [key]: {
            ...state,
            open: true,
            tabs: existing
              ? state.tabs.map((item) => (item.id === existing.id ? updated : item))
              : [...state.tabs, updated],
            activeTabId: updated.id,
          },
        };
      });
    });
  }, [location.pathname, location.search]);

  useEffect(() => {
    return subscribeBrowserPreviewOpen((request) => {
      const url = normalizeBrowserPreviewUrl(request.url);
      if (!url) return;
      const key = getChatWindowKey(location.pathname, location.search);
      setChatWindowStates((current) => {
        const state = current[key] ?? createChatWindowState();
        if (request.source === "frame") {
          const frameTab = state.tabs.find(
            (tab) => tab.id === request.frameName && tab.kind === "browser",
          );
          if (!frameTab) return current;
          return {
            ...current,
            [key]: {
              ...state,
              tabs: state.tabs.map((tab) =>
                tab.id === frameTab.id
                  ? {
                      ...tab,
                      browserNavigation: pushBrowserNavigation(tab, url),
                      title: getBrowserPreviewTitle(url),
                      url,
                    }
                  : tab,
              ),
            },
          };
        }
        const existing = request.newTab
          ? undefined
          : [...state.tabs].reverse().find((tab) => tab.kind === "browser");
        const tab: ChatWindowTab = existing ?? {
          id: createChatWindowTabId(),
          title: getBrowserPreviewTitle(url),
          kind: "browser",
        };
        const updatedTab = {
          ...tab,
          browserNavigation: pushBrowserNavigation(tab, url),
          browserLoadUrl: url,
          title: getBrowserPreviewTitle(url),
          url,
          refreshToken: Date.now(),
        };
        return {
          ...current,
          [key]: {
            ...state,
            open: true,
            tabs: existing
              ? state.tabs.map((item) => (item.id === existing.id ? updatedTab : item))
              : [...state.tabs, updatedTab],
            activeTabId: updatedTab.id,
          },
        };
      });
    });
  }, [location.pathname, location.search]);

  useEffect(() => {
    return subscribeImagePreviewOpen((request) => {
      const key = getChatWindowKey(location.pathname, location.search);
      setChatWindowStates((current) => {
        const state = current[key] ?? createChatWindowState();
        const existing = [...state.tabs]
          .reverse()
          .find((tab) => tab.kind === "image" && tab.url === request.url);
        const title = request.filename?.trim() || "图片预览";
        const tab: ChatWindowTab = existing ?? {
          id: createChatWindowTabId(),
          title,
          kind: "image",
        };
        const updatedTab = {
          ...tab,
          title,
          url: request.url,
          refreshToken: Date.now(),
        };
        return {
          ...current,
          [key]: {
            ...state,
            open: true,
            tabs: existing
              ? state.tabs.map((item) => (item.id === existing.id ? updatedTab : item))
              : [...state.tabs, updatedTab],
            activeTabId: updatedTab.id,
          },
        };
      });
    });
  }, [location.pathname, location.search]);

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
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex h-8 items-center">
              <TitlebarDragRegion className="pointer-events-auto" />
            </div>
          </div>
        ) : null}
        {!hideMainSidebar ? (
          <>
            {!mainSidebarState.collapsed ? (
              <>
                {/* 左列：红绿灯 + 侧栏同一背景，连成一体 */}
                <aside
                  className="app-shell-sidebar main-sidebar flex h-full min-h-0 shrink-0 flex-col overflow-hidden border-border border-r"
                  ref={mainSidebarRef}
                  style={
                    {
                      "--main-sidebar-width": `${mainSidebarState.width}px`,
                    } as CSSProperties
                  }
                >
                  <div className="flex h-8 shrink-0 items-center select-none">
                    <div className="h-full w-[72px] shrink-0" data-tauri-drag-region />
                    <MainSidebarToggleButton collapsed={false} onToggle={toggleMainSidebar} />
                    <TitlebarDragRegion className="pointer-events-auto" />
                  </div>
                  <SidebarHeader
                    onOpenSearch={() => {
                      setIsCommandMenuOpen(false);
                      setIsChatSearchOpen(true);
                    }}
                  />
                  <nav
                    className="space-y-0.5 px-2 py-2 pb-1 max-sm:px-1.5"
                    aria-label="Main navigation"
                  >
                    {navItems.slice(0, 1).map((item) => (
                      <SidebarNavItem item={item} key={item.to} />
                    ))}
                  </nav>
                  <div className="sidebar-scroll-area h-0 min-h-0 flex-1 overflow-y-auto">
                    <nav
                      className="space-y-0.5 px-2 pt-0 max-sm:px-1.5"
                      aria-label="Secondary navigation"
                    >
                      {navItems.slice(1).map((item) => (
                        <SidebarNavItem item={item} key={item.to} />
                      ))}
                    </nav>
                    <WorkspaceConversationGroups />
                  </div>

                  <footer className="relative mt-auto border-border border-t px-2 py-1 max-sm:px-1.5">
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
                      <div className="absolute right-2 bottom-full left-2 mb-2 overflow-hidden rounded-md border border-border bg-popover p-1 shadow-lg max-sm:right-1.5 max-sm:left-1.5">
                        <NavLink
                          className={({ isActive }: NavLinkRenderProps) =>
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
                {/* biome-ignore lint/a11y/useSemanticElements: the interactive resize separator needs pointer events and a rendered handle. */}
                <div
                  aria-label="调整 Sidebar 宽度"
                  aria-orientation="vertical"
                  aria-valuemax={MAIN_SIDEBAR_MAX_WIDTH}
                  aria-valuemin={MAIN_SIDEBAR_MIN_WIDTH}
                  aria-valuenow={Math.round(mainSidebarState.width)}
                  className="main-sidebar-resize max-md:hidden"
                  onDoubleClick={() => setMainSidebarWidth(MAIN_SIDEBAR_DEFAULT_WIDTH)}
                  onKeyDown={handleMainSidebarResizeKeyDown}
                  onPointerDown={beginMainSidebarResize}
                  role="separator"
                  tabIndex={0}
                  title="拖动调整 Sidebar 宽度；双击恢复默认宽度"
                />
              </>
            ) : null}

            {/* 右列：内容区铺满到窗口顶部，拖拽条透明浮在上方 */}
            <div
              className={`app-shell-content relative flex min-w-0 flex-1 flex-col ${!mainSidebarState.collapsed ? "max-sm:w-[calc(100vw-4rem)]" : "is-main-sidebar-collapsed w-full"} ${isChatPage ? "chat-page" : ""}`}
            >
              <div
                className={`chat-split-layout ${isChatPanelOpen ? "is-open" : ""} ${isChatPanelExpanded ? "is-expanded" : ""}`}
              >
                {!isChatPanelExpanded ? (
                  <motion.section
                    layout={!shouldReduceMotion}
                    className="min-h-0 flex-1 overflow-y-auto"
                    style={
                      isChatPanelOpen
                        ? {
                            flexBasis: `${(1 - chatPanelSplitRatio) * 100}%`,
                          }
                        : undefined
                    }
                    transition={chatPanelTransition}
                  >
                    <Outlet />
                  </motion.section>
                ) : null}
                <AnimatePresence initial={false}>
                  {isChatPanelOpen && !isChatPanelExpanded ? (
                    <ChatSplitDivider
                      key="chat-split-divider"
                      ratio={chatPanelSplitRatio}
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
                  ) : null}
                  {isChatPanelOpen ? (
                    <ChatWorkspaceWindow
                      key="chat-workspace-window"
                      expanded={isChatPanelExpanded}
                      maximizeShortcut={formatShortcut(shortcutSettings.chatSidebarMaximize)}
                      panelShortcut={formatShortcut(shortcutSettings.chatSidebar)}
                      split
                      workspaceId={chatWorkspaceId}
                      cwd={chatWorkspaceCwd}
                      state={chatWindowStates[chatWindowKey] ?? createChatWindowState()}
                      onToggle={() =>
                        setChatWindowStates((current) => ({
                          ...current,
                          [chatWindowKey]: {
                            ...(current[chatWindowKey] ?? createChatWindowState()),
                            open: false,
                            expanded: false,
                          },
                        }))
                      }
                      onToggleExpanded={() =>
                        setChatWindowStates((current) => {
                          const state = current[chatWindowKey] ?? createChatWindowState();
                          return {
                            ...current,
                            [chatWindowKey]: { ...state, expanded: !state.expanded },
                          };
                        })
                      }
                      onChange={(next) =>
                        setChatWindowStates((current) => ({ ...current, [chatWindowKey]: next }))
                      }
                    />
                  ) : null}
                </AnimatePresence>
              </div>
              <div
                className={`pointer-events-none absolute inset-x-0 top-0 z-10 flex h-8 items-center ${isChatPage ? "chat-top-actions-layer" : ""}`}
              >
                {mainSidebarState.collapsed ? (
                  <div className="pointer-events-auto flex h-8 shrink-0 items-center self-start">
                    <div className="h-full w-[72px] shrink-0" data-tauri-drag-region />
                    <MainSidebarToggleButton collapsed onToggle={toggleMainSidebar} />
                  </div>
                ) : null}
                {!isChatPage ? (
                  <TitlebarDragRegion className="pointer-events-auto" />
                ) : (
                  <div aria-hidden="true" className="min-w-0 flex-1" />
                )}
                <TopActions
                  isPanelOpen={isChatPanelOpen}
                  onTogglePanel={() => {
                    if (!isChatPage) return;
                    setChatWindowStates((current) => {
                      const state = current[chatWindowKey] ?? createChatWindowState();
                      const open = !state.open;
                      return {
                        ...current,
                        [chatWindowKey]: {
                          ...state,
                          open,
                          expanded: open ? state.expanded : false,
                        },
                      };
                    });
                  }}
                  panelShortcut={formatShortcut(shortcutSettings.chatSidebar)}
                  showPanelToggle={isChatPage && !isChatPanelOpen}
                />
              </div>
            </div>
          </>
        ) : null}
      </div>
      {isCommandMenuOpen && <CommandMenu onClose={() => setIsCommandMenuOpen(false)} />}
      {isChatSearchOpen && <ChatSearchMenu onClose={() => setIsChatSearchOpen(false)} />}
    </main>
  );
}

function ChatServerStatusBanner() {
  const queryClient = useQueryClient();
  const enabled = canMonitorChatServer();
  const canRestart = canRestartChatServer();
  const statusQuery = useQuery({
    queryKey: ["chat-server-status"],
    queryFn: getChatServerStatus,
    enabled,
    refetchInterval: 60_000,
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
      void queryClient.invalidateQueries({ queryKey: ["workspace-projects"] });
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
      className={`fixed top-10 right-4 z-40 flex min-h-10 w-[min(24rem,calc(100vw-2rem))] items-center justify-between gap-3 rounded-lg border px-4 py-2 text-xs shadow-lg backdrop-blur-sm max-sm:top-9 max-sm:right-3 max-sm:left-3 max-sm:w-auto max-sm:items-start ${isRestarting ? "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200" : "border-destructive/30 bg-destructive/10 text-destructive"}`}
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
        disabled={restartMutation.isPending || statusQuery.isFetching || isRestarting}
        onClick={() => {
          if (canRestart) restartMutation.mutate();
          else void statusQuery.refetch();
        }}
        size="sm"
        type="button"
        variant="outline"
      >
        <RefreshCw
          className={
            restartMutation.isPending || statusQuery.isFetching
              ? "size-3.5 animate-spin"
              : "size-3.5"
          }
        />
        {canRestart ? "重启服务" : "刷新状态"}
      </Button>
    </div>
  );
}

function SidebarHeader({ onOpenSearch }: { onOpenSearch: () => void }) {
  return (
    <header className="flex items-center justify-between px-3 pt-3 pb-2 max-md:justify-center max-md:px-2 max-sm:px-1.5">
      <h1 className="min-w-0 truncate pl-2 font-semibold text-[15px] text-foreground max-md:hidden">
        ChatDesk
      </h1>
      <Button
        aria-label="搜索聊天"
        className="size-7 text-muted-foreground max-md:hidden"
        onClick={onOpenSearch}
        size="icon"
        title="搜索聊天（⌘/Ctrl+K）"
        type="button"
        variant="ghost"
      >
        <Search className="size-4" />
      </Button>
    </header>
  );
}

function MainSidebarToggleButton({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const label = collapsed ? "展开 Sidebar" : "收起 Sidebar";
  return (
    <Button
      aria-label={label}
      aria-pressed={collapsed}
      className={`relative z-20 size-7 shrink-0 translate-y-0.5 text-muted-foreground pointer-events-auto ${collapsed ? "" : "max-md:hidden"}`}
      data-tauri-drag-region="false"
      onClick={onToggle}
      size="icon"
      title={label}
      type="button"
      variant="ghost"
    >
      <PanelLeft className="size-4" />
    </Button>
  );
}

function SidebarNavItem({ item }: { item: (typeof navItems)[number] }) {
  const location = useLocation();
  const Icon = item.icon;
  const isChatItem = item.to === "/chat";
  const to = isChatItem ? chatNewPath() : item.to;
  const isItemActive = isChatItem ? location.pathname === "/chat/new" : undefined;

  return (
    <NavLink
      className={({ isActive }: NavLinkRenderProps) =>
        `sidebar-nav-item flex h-8 w-full items-center gap-2 px-3 text-left text-[13px] font-medium transition-colors max-md:justify-center max-md:px-0 max-sm:h-8 ${
          (isItemActive ?? isActive) ? "is-active" : ""
        }`
      }
      state={isChatItem ? chatNewNavigationState() : undefined}
      to={to}
    >
      {({ isActive }: NavLinkRenderProps) => (
        <>
          <Icon className="size-4 shrink-0" />
          <span className="max-md:hidden">{item.label}</span>
          <span className="sr-only">{(isItemActive ?? isActive) ? "当前页面" : ""}</span>
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

function WorkspaceConversationGroups() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const shouldReduceMotion = Boolean(useReducedMotion());
  const sidebarMotionTransition = getWorkbenchMotionTransition(shouldReduceMotion);
  const sidebarLayoutTransition = getWorkbenchLayoutTransition(shouldReduceMotion);
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
  const [copiedConversation, setCopiedConversation] = useState<{
    id: string;
    kind: "id" | "markdown";
  } | null>(null);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const copiedResetTimerRef = useRef<number | null>(null);
  const [workspaceToDelete, setWorkspaceToDelete] = useState<WorkspaceProject | null>(null);
  const [workspaceSort, setWorkspaceSort] = useState<WorkspaceSort>(loadWorkspaceSort);
  const [desktopStateRestored, setDesktopStateRestored] = useState(() => !isDesktop());
  const [sidebarMotionEnabled, setSidebarMotionEnabled] = useState(false);
  const chatIndexQuery = useQuery({
    queryKey: ["chat-index"],
    queryFn: loadChatIndex,
  });
  const workspaceProjectsQuery = useQuery({
    queryKey: ["workspace-projects"],
    queryFn: loadWorkspaceProjects,
  });
  const chatRoute = parseChatLocation(location.pathname, location.search);
  const activeSessionId = chatRoute.kind === "session" ? chatRoute.sessionId : null;
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
        workspaceSort,
      ),
    [chatIndexQuery.data, workspaceProjectsQuery.data, workspaceSort],
  );
  const isPending = chatIndexQuery.isPending || workspaceProjectsQuery.isPending;
  const isError = chatIndexQuery.isError || workspaceProjectsQuery.isError;
  // 首屏列表渲染与桌面状态恢复完成前，跳过 Sidebar 菜单的入场动画，保留展开/收起动画。
  const suppressSidebarEntrance = shouldReduceMotion || !sidebarMotionEnabled;
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
        navigate(
          chatNewPath({
            workspaceId: item.workspaceId ?? (item.cwd ? `cwd:${item.cwd}` : ""),
            workspaceCwd: item.cwd,
          }),
          { replace: true, state: chatNewNavigationState() },
        );
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
  const deleteWorkspaceMutation = useMutation({
    mutationFn: (project: WorkspaceProject) => removeWorkspaceProject(project.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-projects"] });
      setWorkspaceToDelete(null);
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
    if (!isDesktop()) return;
    void Promise.all([
      settingsStore.get<unknown>(CHAT_UNREAD_STORE_KEY),
      settingsStore.get<unknown>(WORKSPACE_COLLAPSE_STORE_KEY),
      settingsStore.get<unknown>(WORKSPACE_SORT_STORE_KEY),
    ])
      .then(([unread, collapse, sort]) => {
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
        if (isWorkspaceSort(sort)) setWorkspaceSort(sort);
        setDesktopStateRestored(true);
      })
      .catch((error) => {
        console.error("Failed to load desktop navigation state", error);
        setDesktopStateRestored(true);
      });
  }, []);

  useEffect(() => {
    if (!desktopStateRestored || isPending || isError) return;
    const frame = requestAnimationFrame(() => setSidebarMotionEnabled(true));
    return () => cancelAnimationFrame(frame);
  }, [desktopStateRestored, isPending, isError]);

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

  useEffect(() => {
    return () => {
      if (copiedResetTimerRef.current !== null) {
        window.clearTimeout(copiedResetTimerRef.current);
      }
    };
  }, []);

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

  const isWorkspaceSectionCollapsed = collapseOverride[WORKSPACE_SECTION_COLLAPSE_KEY] ?? false;

  function toggleWorkspaceSection() {
    setCollapseOverride((current) => {
      const next = {
        ...current,
        [WORKSPACE_SECTION_COLLAPSE_KEY]: !(current[WORKSPACE_SECTION_COLLAPSE_KEY] ?? false),
      };
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
    navigate(chatNewPath({ workspaceId: group.key, workspaceCwd: group.cwd }), {
      state: chatNewNavigationState(),
    });
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
    navigate(chatSessionPath(sessionId));
  }

  function markCopiedConversation(id: string, kind: "id" | "markdown") {
    setCopiedConversation({ id, kind });
    if (copiedResetTimerRef.current !== null) {
      window.clearTimeout(copiedResetTimerRef.current);
    }
    copiedResetTimerRef.current = window.setTimeout(() => {
      setCopiedConversation(null);
      copiedResetTimerRef.current = null;
    }, 1500);
  }

  async function copyConversationId(sessionId: string) {
    const copied = await copyChatConversationId(sessionId);
    if (!copied) {
      setCopiedConversation(null);
      return;
    }
    markCopiedConversation(sessionId, "id");
  }

  async function copyConversationMarkdown(session: ChatIndexItem) {
    const loaded = await loadChatSession(session.id);
    const copied = loaded
      ? await copyChatConversationMarkdown({
          title: loaded.title,
          messages: loaded.messages,
        })
      : false;
    if (!copied) {
      setCopiedConversation(null);
      return;
    }
    markCopiedConversation(session.id, "markdown");
  }

  async function regenerateConversationTitle(session: ChatIndexItem) {
    const sessionStatus = serverStatuses[session.id];
    const isRunning = sessionStatus === "submitted" || sessionStatus === "streaming";
    if (isRunning || renamingSessionId === session.id || session.messageCount === 0) return;
    setRenamingSessionId(session.id);
    try {
      await regenerateChatSessionTitle(session.id);
      await queryClient.invalidateQueries({ queryKey: ["chat-index"] });
    } catch (error) {
      console.error("Failed to regenerate chat title", error);
    } finally {
      setRenamingSessionId((current) => (current === session.id ? null : current));
    }
  }

  function confirmRemoveSession() {
    if (!sessionToDelete || deleteSessionMutation.isPending) return;
    deleteSessionMutation.mutate(sessionToDelete);
  }

  return (
    <section
      aria-labelledby="workspace-conversations-heading"
      className="px-2 pt-2 pb-2 max-md:hidden"
    >
      <div className="group flex h-8 items-center rounded-md px-2">
        <h2
          className="min-w-0 flex-1 font-medium text-[13px] text-muted-foreground/55"
          id="workspace-conversations-heading"
        >
          <button
            aria-expanded={!isWorkspaceSectionCollapsed}
            aria-label={isWorkspaceSectionCollapsed ? "展开 Workspace" : "收起 Workspace"}
            className="flex w-full items-center gap-1 text-left text-muted-foreground/55"
            onClick={toggleWorkspaceSection}
            title="Workspace"
            type="button"
          >
            <span className="truncate text-muted-foreground/55">Workspace</span>
            <ChevronRight
              aria-hidden="true"
              className={`size-3.5 shrink-0 opacity-0 transition-[transform,opacity] group-hover:opacity-100 group-focus-within:opacity-100 ${isWorkspaceSectionCollapsed ? "" : "rotate-90"}`}
            />
          </button>
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
            <DropdownMenuItem
              onSelect={() => {
                setWorkspaceSort("name");
                persistWorkspaceSort("name");
              }}
            >
              <span className="flex-1">按名称</span>
              {workspaceSort === "name" ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setWorkspaceSort("updated");
                persistWorkspaceSort("updated");
              }}
            >
              <span className="flex-1">按更新</span>
              {workspaceSort === "updated" ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                setWorkspaceSort("count");
                persistWorkspaceSort("count");
              }}
            >
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
      {deleteWorkspaceMutation.error ? (
        <p className="px-2 py-1 text-[11px] text-destructive">
          {describeError(deleteWorkspaceMutation.error)}
        </p>
      ) : null}
      {isPending ? (
        <WorkspaceConversationSkeleton />
      ) : isError ? (
        <p className="px-2 py-2 text-[12px] text-destructive">对话记录加载失败</p>
      ) : (
        <div className="space-y-0.5">
          {groups.map((group) => {
            const isExpanded = expandedGroups.has(group.key);
            const isRecent = group.key === DEFAULT_WORKSPACE_ID;
            if (!isRecent && isWorkspaceSectionCollapsed) return null;
            const isCollapsed = isGroupCollapsed(group);
            const visibleSessions =
              isRecent || isExpanded ? group.sessions : group.sessions.slice(0, 5);
            const hiddenCount = group.sessions.length - 5;

            return (
              <div className={isRecent ? "pt-2" : undefined} key={group.key}>
                <div
                  className={`group flex h-8 min-w-0 items-center rounded-md ${isRecent ? "pl-2" : "transition-colors hover:bg-accent/60"}`}
                >
                  {isRecent ? (
                    <h2 className="min-w-0 flex-1 font-medium text-[13px] text-muted-foreground/55">
                      <button
                        aria-expanded={!isCollapsed}
                        aria-label={isCollapsed ? `展开 ${group.label}` : `收起 ${group.label}`}
                        className="flex w-full items-center gap-1 text-left text-muted-foreground/55"
                        onClick={() => toggleCollapsed(group)}
                        title={group.label}
                        type="button"
                      >
                        <span className="truncate text-muted-foreground/55">{group.label}</span>
                        <ChevronRight
                          aria-hidden="true"
                          className={`size-3.5 shrink-0 opacity-0 transition-[transform,opacity] group-hover:opacity-100 group-focus-within:opacity-100 ${isCollapsed ? "" : "rotate-90"}`}
                        />
                      </button>
                    </h2>
                  ) : (
                    <button
                      aria-expanded={!isCollapsed}
                      aria-label={isCollapsed ? `展开 ${group.label}` : `收起 ${group.label}`}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-3 text-left font-medium text-[13px] text-foreground"
                      onClick={() => toggleCollapsed(group)}
                      title={group.label}
                      type="button"
                    >
                      <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{group.label}</span>
                    </button>
                  )}
                  <button
                    aria-label={`在 ${group.label} 中新建对话`}
                    className={`flex shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 ${isRecent ? "mr-1 size-5" : "mr-0.5 size-6"}`}
                    onClick={() => startWorkspaceSession(group)}
                    title={`在 ${group.label} 中新建对话`}
                    type="button"
                  >
                    <Plus className="size-3.5" />
                  </button>
                  {group.key !== DEFAULT_WORKSPACE_ID ? (
                    <button
                      aria-label={`${workspaceProjectsQuery.data?.some((project) => project.id === group.key) ? "移除" : "移出"} ${group.label}`}
                      className="mr-1 flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                      disabled={deleteWorkspaceMutation.isPending}
                      onClick={() => {
                        const project = workspaceProjectsQuery.data?.find(
                          (item) => item.id === group.key,
                        );
                        if (project) setWorkspaceToDelete(project);
                      }}
                      title="移除 Workspace"
                      type="button"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  ) : null}
                </div>
                <AnimatePresence initial={false}>
                  {!isCollapsed ? (
                    <motion.div
                      animate={{ height: "auto", opacity: 1 }}
                      className="overflow-hidden"
                      exit={{ height: 0, opacity: 0 }}
                      initial={suppressSidebarEntrance ? false : { height: 0, opacity: 0 }}
                      transition={
                        suppressSidebarEntrance
                          ? REDUCED_MOTION_TRANSITION
                          : sidebarLayoutTransition
                      }
                    >
                      {group.sessions.length > 0 ? (
                        <motion.div
                          className="space-y-0.5"
                          layout={!suppressSidebarEntrance}
                          transition={
                            suppressSidebarEntrance
                              ? REDUCED_MOTION_TRANSITION
                              : sidebarLayoutTransition
                          }
                        >
                          <AnimatePresence initial={false}>
                            {visibleSessions.map((session) => {
                              const isActive = activeSessionId === session.id;
                              const sessionStatus = serverStatuses[session.id];
                              const isRunning =
                                sessionStatus === "submitted" || sessionStatus === "streaming";
                              const isUnread = unreadSessionIds.has(session.id);
                              const isRenaming = renamingSessionId === session.id;

                              return (
                                <motion.div
                                  animate={{ height: "2rem", opacity: 1 }}
                                  className="overflow-hidden"
                                  exit={{ height: 0, opacity: 0 }}
                                  initial={
                                    suppressSidebarEntrance ? false : { height: 0, opacity: 0 }
                                  }
                                  key={session.id}
                                  layout={!suppressSidebarEntrance}
                                  transition={
                                    suppressSidebarEntrance
                                      ? REDUCED_MOTION_TRANSITION
                                      : sidebarMotionTransition
                                  }
                                >
                                  <ContextMenu>
                                    <ChatConversationHoverCard
                                      cwd={session.cwd ?? group.cwd}
                                      session={session}
                                      workspaceId={group.key}
                                      workspaceLabel={group.label}
                                    >
                                      <ContextMenuTrigger asChild>
                                        <div
                                          className={`group flex h-8 w-full items-center rounded-md transition-colors ${
                                            isActive
                                              ? "bg-accent text-accent-foreground font-medium"
                                              : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
                                          }`}
                                        >
                                          <button
                                            aria-current={isActive ? "page" : undefined}
                                            className={`flex min-w-0 flex-1 items-center rounded-md py-0 pr-1 text-left font-medium text-[13px] ${isRecent ? "pl-2" : "pl-8"} ${isActive ? "text-accent-foreground" : "text-foreground"}`}
                                            onClick={() => openSession(session.id)}
                                            type="button"
                                          >
                                            <span className="truncate">{session.title}</span>
                                            {isRenaming || isRunning ? (
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
                                      </ContextMenuTrigger>
                                    </ChatConversationHoverCard>
                                    <ContextMenuContent
                                      onCloseAutoFocus={(event) => event.preventDefault()}
                                    >
                                      <ChatConversationMenuItems
                                        Item={ContextMenuItem}
                                        canCopyAsMarkdown={session.messageCount > 0}
                                        canRegenerateTitle={
                                          !isRunning && !isRenaming && session.messageCount > 0
                                        }
                                        conversationIdCopied={
                                          copiedConversation?.id === session.id &&
                                          copiedConversation.kind === "id"
                                        }
                                        conversationMarkdownCopied={
                                          copiedConversation?.id === session.id &&
                                          copiedConversation.kind === "markdown"
                                        }
                                        onCopyAsMarkdown={() =>
                                          void copyConversationMarkdown(session)
                                        }
                                        onCopyConversationId={() =>
                                          void copyConversationId(session.id)
                                        }
                                        onRegenerateTitle={() =>
                                          void regenerateConversationTitle(session)
                                        }
                                      />
                                    </ContextMenuContent>
                                  </ContextMenu>
                                </motion.div>
                              );
                            })}
                          </AnimatePresence>
                          {hiddenCount > 0 && !isRecent ? (
                            <button
                              aria-expanded={isExpanded}
                              className="flex h-8 w-full items-center gap-1 rounded-md pr-2 pl-8 text-left text-[12px] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
                              onClick={() => toggleExpanded(group.key)}
                              type="button"
                            >
                              <ChevronDown
                                className={`size-3.5 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              />
                              <span>{isExpanded ? "收起" : `展开其余 ${hiddenCount} 条`}</span>
                            </button>
                          ) : null}
                        </motion.div>
                      ) : (
                        <p
                          className={`px-2 py-1 text-[12px] text-muted-foreground ${isRecent ? "pl-2" : "pl-8"}`}
                        >
                          暂无对话
                        </p>
                      )}
                    </motion.div>
                  ) : null}
                </AnimatePresence>
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
      <AlertDialog
        open={workspaceToDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleteWorkspaceMutation.isPending) setWorkspaceToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除 Workspace？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要移除“
              {workspaceToDelete ? pathBasename(workspaceToDelete.path) : "这个 Workspace"}”吗？
              这只会隐藏 Workspace，不会删除历史对话；之后添加同一路径可以恢复它。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteWorkspaceMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteWorkspaceMutation.isPending}
              onClick={() => {
                if (workspaceToDelete) deleteWorkspaceMutation.mutate(workspaceToDelete);
              }}
              variant="destructive"
            >
              {deleteWorkspaceMutation.isPending ? "移除中..." : "移除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function WorkspaceConversationSkeleton() {
  return (
    <div className="space-y-0.5" role="status" aria-label="正在加载 Workspace 对话记录">
      {[0, 1, 2].map((group) => (
        <div className="flex h-8 items-center gap-2 px-2" key={group}>
          <div className="size-4 animate-pulse rounded bg-muted" />
          <div className="h-3 w-24 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

function groupChatsByWorkspace(
  sessions: ChatIndexItem[],
  projects: Awaited<ReturnType<typeof loadWorkspaceProjects>>,
  sort: WorkspaceSort,
): WorkspaceChatGroup[] {
  const sessionsByWorkspace = new Map<string, ChatIndexItem[]>();
  const defaultSessions: ChatIndexItem[] = [];
  for (const session of sessions) {
    const workspaceKey = getWorkspaceSessionKey(session, projects);
    if (!workspaceKey || workspaceKey === DEFAULT_WORKSPACE_ID) {
      defaultSessions.push(session);
      continue;
    }
    const workspaceSessions = sessionsByWorkspace.get(workspaceKey) ?? [];
    workspaceSessions.push(session);
    sessionsByWorkspace.set(workspaceKey, workspaceSessions);
  }

  const recentGroup: WorkspaceChatGroup = {
    key: DEFAULT_WORKSPACE_ID,
    label: "Task",
    sessions: defaultSessions,
  };
  const workspaceGroups: WorkspaceChatGroup[] = [];

  for (const project of projects) {
    if (project.id === DEFAULT_WORKSPACE_ID) continue;
    const workspaceSessions = sessionsByWorkspace.get(project.id) ?? [];
    workspaceGroups.push({
      key: project.id,
      label: pathBasename(project.path),
      cwd: project.path,
      sessions: workspaceSessions,
    });
    sessionsByWorkspace.delete(project.id);
  }

  return [...sortWorkspaceConversationGroups(workspaceGroups, sort), recentGroup];
}

function pathBasename(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? path
  );
}

function pathDirectory(path: string) {
  const normalized = path.replace(/\\/g, "/");
  const separator = normalized.lastIndexOf("/");
  return separator > 0 ? `${normalized.slice(0, separator)}/` : "";
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

type ChatWindowTab = {
  id: string;
  title: string;
  kind?: "blank" | "workspace" | "git-diff" | "source" | "terminal" | "browser" | "image" | "plan";
  workspaceId?: string;
  cwd?: string;
  path?: string;
  content?: string;
  refreshToken?: number;
  explorerView?: "files" | "git";
  editorMode?: "source" | "diff";
  url?: string;
  browserNavigation?: BrowserNavigationState;
  browserLoadUrl?: string;
  sessionId?: string;
  planId?: string;
  canExecute?: boolean;
  activePlanId?: string;
  activePlanCanExecute?: boolean;
};
type ChatWindowState = {
  open: boolean;
  expanded: boolean;
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
  return {
    open: false,
    expanded: false,
    tabs: [],
    activeTabId: null,
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

function ChatWorkspaceWindow({
  expanded,
  maximizeShortcut,
  panelShortcut,
  onChange,
  onToggle,
  onToggleExpanded,
  split = false,
  state,
  workspaceId,
  cwd,
}: {
  expanded: boolean;
  maximizeShortcut: string;
  panelShortcut: string;
  onChange: (state: ChatWindowState) => void;
  onToggle: () => void;
  onToggleExpanded: () => void;
  split?: boolean;
  state: ChatWindowState;
  workspaceId: string;
  cwd: string;
}) {
  const interactionRef = useRef<WindowInteraction | null>(null);
  const sidebarResizeRef = useRef<{ startX: number; initialWidth: number } | null>(null);
  const draggedTabIdRef = useRef<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const shouldReduceMotion = Boolean(useReducedMotion());
  const panelTransition = getWorkbenchLayoutTransition(shouldReduceMotion);
  const activeTab = state.tabs.find((tab) => tab.id === state.activeTabId);
  const activeTabId = activeTab?.id;
  const workspaceTab =
    activeTab?.kind === "workspace" ||
    activeTab?.kind === "source" ||
    activeTab?.kind === "git-diff"
      ? activeTab
      : null;
  const terminalTab = activeTab?.kind === "terminal" ? activeTab : null;
  const browserTab = activeTab?.kind === "browser" ? activeTab : null;
  const browserNavigation = getBrowserNavigationState(browserTab ?? {});
  const imageTab = activeTab?.kind === "image" ? activeTab : null;
  const planTab = activeTab?.kind === "plan" ? activeTab : null;
  const activeTabWorkspaceId = workspaceTab?.workspaceId;
  const explorerCwd = cwd.trim();
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [tabDropTarget, setTabDropTarget] = useState<{
    id: string;
    edge: "before" | "after";
  } | null>(null);
  const [selectedPath, setSelectedPath] = useState(workspaceTab?.path ?? "");
  const [explorerView, setExplorerView] = useState<"files" | "git">(
    workspaceTab?.explorerView ?? (workspaceTab?.kind === "git-diff" ? "git" : "files"),
  );
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(() => new Set(["."]));
  const [editorTabs, setEditorTabs] = useState<
    Array<{
      path: string;
      mode: "source" | "diff";
      content?: string;
      originalContent?: string;
      modifiedContent?: string;
      binary?: boolean;
      truncated?: boolean;
    }>
  >([]);
  const [activeEditorPath, setActiveEditorPath] = useState(workspaceTab?.path ?? "");
  const [editorContent, setEditorContent] = useState<{
    path: string;
    mode: "source" | "diff";
    content: string;
    originalContent?: string;
    modifiedContent?: string;
    binary?: boolean;
    truncated?: boolean;
  } | null>(null);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [gitRefreshToken, setGitRefreshToken] = useState(0);
  const [restoreTarget, setRestoreTarget] = useState<{ path?: string; label: string } | null>(null);
  const [commitOpen, setCommitOpen] = useState(false);
  const queryClient = useQueryClient();
  const gitQuery = useQuery({
    queryKey: workspaceGitQueryKey(activeTabWorkspaceId ?? "", explorerCwd),
    queryFn: () =>
      loadServerWorkspaceGit(activeTabWorkspaceId ?? "", explorerCwd) as Promise<WorkspaceGitInfo>,
    enabled:
      Boolean(activeTabWorkspaceId) &&
      (!isDefaultWorkspaceId(activeTabWorkspaceId) || Boolean(explorerCwd)),
    refetchInterval: 15_000,
  });
  const planQuery = useQuery({
    queryKey: ["chat-plan", planTab?.sessionId, planTab?.planId],
    queryFn: () => loadChatPlan(planTab?.sessionId ?? "", planTab?.planId ?? ""),
    enabled: Boolean(planTab?.sessionId && planTab?.planId),
  });
  const planListQuery = useQuery({
    queryKey: ["chat-plans", planTab?.sessionId],
    queryFn: () => loadChatPlans(planTab?.sessionId ?? ""),
    enabled: Boolean(planTab?.sessionId),
  });
  const gitInfo = gitQuery.data;
  const isGitWorkspace = gitInfo?.isRepository === true;
  const gitSummary = gitInfo?.summary ?? null;
  const directoryPaths = useMemo(
    () => [...expandedDirectories].filter((path) => path === "." || path.length > 0),
    [expandedDirectories],
  );
  const directoryQueries = useQueries({
    queries: directoryPaths.map((path) => ({
      queryKey: ["workspace-files", activeTabWorkspaceId, explorerCwd, path],
      queryFn: () => loadServerWorkspaceFiles(activeTabWorkspaceId ?? "", path, explorerCwd),
      enabled:
        Boolean(activeTabWorkspaceId) &&
        (!isDefaultWorkspaceId(activeTabWorkspaceId) || Boolean(explorerCwd)),
    })),
  });
  const directoryMap = useMemo(() => {
    const map = new Map<
      string,
      { entries: WorkspaceFileEntry[]; isLoading: boolean; error?: string }
    >();
    directoryPaths.forEach((path, index) => {
      const query = directoryQueries[index];
      map.set(path, {
        entries: (query.data as { entries?: WorkspaceFileEntry[] } | undefined)?.entries ?? [],
        isLoading: query.isLoading,
        error: query.error instanceof Error ? query.error.message : undefined,
      });
    });
    return map;
  }, [directoryPaths, directoryQueries]);

  async function refreshExplorer() {
    const workspaceIdToRefresh = activeTabWorkspaceId;
    setGitRefreshToken((value) => value + 1);
    if (!workspaceIdToRefresh) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: workspaceGitQueryKey(workspaceIdToRefresh) }),
      queryClient.invalidateQueries({ queryKey: ["workspace-files", workspaceIdToRefresh] }),
    ]);
  }

  const restoreMutation = useMutation({
    mutationFn: (path?: string) =>
      restoreServerWorkspaceGit(activeTabWorkspaceId ?? workspaceId, path, explorerCwd),
    onSuccess: () => {
      setRestoreTarget(null);
      setViewerError(null);
      void refreshExplorer();
    },
    onError: (error) => {
      setViewerError(error instanceof Error ? error.message : String(error));
    },
  });

  useEffect(() => {
    if (!activeTabId) return;
    const nextView =
      workspaceTab?.explorerView ?? (workspaceTab?.kind === "git-diff" ? "git" : "files");
    setExplorerView(gitInfo?.isRepository === false ? "files" : nextView);
    setSelectedPath(workspaceTab?.path ?? "");
    setActiveEditorPath(workspaceTab?.path ?? "");
    setEditorContent(null);
    setViewerError(null);
  }, [
    activeTabId,
    gitInfo?.isRepository,
    workspaceTab?.explorerView,
    workspaceTab?.kind,
    workspaceTab?.path,
  ]);

  // Refreshing Git intentionally reloads the selected editor snapshot as well as the sidebar.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh intentionally reloads current editor content.
  useEffect(() => {
    let active = true;
    const path = activeEditorPath || selectedPath;
    if (!workspaceTab || !path || !activeTabWorkspaceId || planTab) return;
    const mode = explorerView === "git" ? "diff" : "source";
    if (mode === "source" && workspaceTab.path === path && workspaceTab.content !== undefined) {
      setEditorContent({ path, mode, content: workspaceTab.content });
      setEditorTabs((tabs) => {
        const index = tabs.findIndex((tab) => tab.path === path);
        if (index < 0) return [...tabs, { path, mode, content: workspaceTab.content }];
        const next = [...tabs];
        next[index] = { path, mode, content: workspaceTab.content };
        return next;
      });
      return;
    }
    const request =
      mode === "source"
        ? loadServerWorkspaceFile(activeTabWorkspaceId, path, explorerCwd)
        : loadServerWorkspaceGitDiff(activeTabWorkspaceId, path, explorerCwd);
    void request
      .then((result) => {
        if (!active) return;
        if (mode === "source") {
          const value = result as { path: string; content: string };
          setEditorContent({ path: value.path, mode, content: value.content });
          setEditorTabs((tabs) => {
            const index = tabs.findIndex((tab) => tab.path === path);
            if (index < 0) return [...tabs, { path, mode, content: value.content }];
            const next = [...tabs];
            next[index] = { path, mode, content: value.content };
            return next;
          });
        } else {
          const value = result as {
            path: string;
            content: string;
            originalContent?: string;
            modifiedContent?: string;
            binary?: boolean;
            truncated?: boolean;
          };
          setEditorContent({ ...value, mode });
          setEditorTabs((tabs) => {
            const index = tabs.findIndex((tab) => tab.path === path);
            if (index < 0) return [...tabs, { path, mode }];
            const next = [...tabs];
            next[index] = { path, mode };
            return next;
          });
        }
      })
      .catch((error) => {
        if (active) setViewerError(error instanceof Error ? error.message : String(error));
      });
    return () => {
      active = false;
    };
  }, [
    activeTabWorkspaceId,
    activeEditorPath,
    explorerCwd,
    explorerView,
    gitRefreshToken,
    selectedPath,
    workspaceTab,
  ]);

  function updateWorkspaceTab(patch: Partial<ChatWindowTab>) {
    if (!activeTab) return;
    onChange({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === activeTab.id ? { ...tab, ...patch, kind: "workspace" } : tab,
      ),
    });
  }

  function selectPlan(planId: string) {
    if (!planTab?.sessionId) return;
    void loadChatPlan(planTab.sessionId, planId)
      .then((plan) => {
        onChange({
          ...state,
          tabs: state.tabs.map((tab) =>
            tab.id === planTab.id
              ? {
                  ...tab,
                  title: plan.fileName,
                  planId: plan.id,
                  content: plan.content,
                  canExecute: plan.id === tab.activePlanId && tab.activePlanCanExecute,
                }
              : tab,
          ),
        });
      })
      .catch((error) => setViewerError(error instanceof Error ? error.message : String(error)));
  }

  function refreshPlan() {
    if (!planTab) return;
    void planQuery
      .refetch()
      .then(({ data }) => {
        if (!data) return;
        onChange({
          ...state,
          tabs: state.tabs.map((tab) =>
            tab.id === planTab.id
              ? { ...tab, title: data.fileName, planId: data.id, content: data.content }
              : tab,
          ),
        });
      })
      .catch((error) => setViewerError(error instanceof Error ? error.message : String(error)));
  }

  function selectFile(path: string, mode: "source" | "diff") {
    setSelectedPath(path);
    setActiveEditorPath(path);
    setExplorerView(mode === "diff" ? "git" : "files");
    updateWorkspaceTab({ path, editorMode: mode, explorerView: mode === "diff" ? "git" : "files" });
  }

  function selectGitFile(file: WorkspaceGitFile) {
    selectFile(file.path, "diff");
  }

  function toggleDirectory(path: string) {
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function switchExplorerView(view: "files" | "git") {
    if (view === "git" && !isGitWorkspace) return;
    setExplorerView(view);
    updateWorkspaceTab({ explorerView: view });
    if (view === "git") {
      const first = gitSummary?.files[0];
      if (first) selectGitFile(first);
    }
  }

  function closeEditor(path: string) {
    const next = editorTabs.filter((tab) => tab.path !== path);
    setEditorTabs(next);
    if (activeEditorPath !== path) return;
    const fallback = next[next.length - 1];
    setActiveEditorPath(fallback?.path ?? "");
    setSelectedPath(fallback?.path ?? "");
    if (fallback) {
      updateWorkspaceTab({
        path: fallback.path,
        editorMode: fallback.mode,
        explorerView: fallback.mode === "diff" ? "git" : "files",
      });
      return;
    }
    setEditorContent(null);
    updateWorkspaceTab({ path: "" });
  }

  function closeAllEditors() {
    setEditorTabs([]);
    setActiveEditorPath("");
    setSelectedPath("");
    setEditorContent(null);
    updateWorkspaceTab({ path: "" });
  }

  function restoreFile(file: WorkspaceGitFile) {
    setRestoreTarget({ path: file.path, label: file.path });
  }

  function renderDirectory(path: string, depth = 0): ReactNode {
    const directory = directoryMap.get(path);
    if (!directory) return null;
    if (directory.isLoading) {
      return (
        <div className="chat-explorer-skeleton-list" style={{ paddingLeft: 8 + depth * 14 }}>
          {[0, 1, 2].map((item) => (
            <div className="chat-explorer-skeleton" key={item} />
          ))}
        </div>
      );
    }
    if (directory.error) {
      return (
        <div className="chat-explorer-error" style={{ paddingLeft: 12 + depth * 14 }}>
          {directory.error}
        </div>
      );
    }
    if (directory.entries.length === 0) {
      return (
        <div className="chat-explorer-empty" style={{ paddingLeft: 12 + depth * 14 }}>
          目录为空
        </div>
      );
    }
    return directory.entries.map((entry) => {
      const isExpanded = expandedDirectories.has(entry.path);
      const gitFile = gitSummary?.files.find((file) => file.path === entry.path);
      return (
        <div key={entry.path}>
          <div
            className={`chat-explorer-row ${selectedPath === entry.path ? "is-active" : ""}`}
            style={{ paddingLeft: 8 + depth * 14 }}
          >
            {entry.kind === "dir" ? (
              <button
                aria-label={`${isExpanded ? "收起" : "展开"} ${entry.name}`}
                className="chat-explorer-chevron"
                onClick={() => toggleDirectory(entry.path)}
                type="button"
              >
                {isExpanded ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
              </button>
            ) : (
              <span className="chat-explorer-chevron" />
            )}
            <button
              className="chat-explorer-entry"
              onClick={() =>
                entry.kind === "dir"
                  ? toggleDirectory(entry.path)
                  : selectFile(entry.path, "source")
              }
              type="button"
            >
              <ExplorerFileIcon
                className="size-3.5"
                kind={explorerFileIconKind(entry.path, {
                  entryKind: entry.kind === "dir" ? "dir" : "file",
                  expanded: isExpanded,
                })}
              />
              <span className="chat-explorer-name">{entry.name}</span>
              {gitFile ? (
                <span className={`chat-explorer-status is-${gitFile.status}`}>
                  {gitFile.status[0].toUpperCase()}
                </span>
              ) : null}
            </button>
          </div>
          {entry.kind === "dir" && isExpanded ? renderDirectory(entry.path, depth + 1) : null}
        </div>
      );
    });
  }

  const editorView = editorContent ? (
    <FileViewer
      path={editorContent.path}
      mode={editorContent.mode}
      content={editorContent.content}
      originalContent={editorContent.originalContent}
      modifiedContent={editorContent.modifiedContent}
      binary={editorContent.binary}
      truncated={editorContent.truncated}
    />
  ) : viewerError ? (
    <div className="chat-workspace-window-empty text-destructive">{viewerError}</div>
  ) : (
    <div className="chat-workspace-window-empty">选择一个文件查看内容</div>
  );

  function selectEditor(tab: { path: string; mode: "source" | "diff" }) {
    setActiveEditorPath(tab.path);
    setSelectedPath(tab.path);
    setExplorerView(tab.mode === "diff" ? "git" : "files");
    updateWorkspaceTab({
      path: tab.path,
      editorMode: tab.mode,
      explorerView: tab.mode === "diff" ? "git" : "files",
    });
  }

  function confirmRestore() {
    if (!restoreTarget || !(activeTabWorkspaceId ?? workspaceId)) return;
    restoreMutation.mutate(restoreTarget.path);
  }

  function beginInteraction(event: ReactPointerEvent, direction: ResizeDirection | "move") {
    if (event.button !== 0 || event.ctrlKey) return;
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

  function beginSidebarResize(event: ReactPointerEvent) {
    event.preventDefault();
    event.stopPropagation();
    const initialWidth = containerRef.current
      ?.querySelector<HTMLElement>(".chat-explorer-sidebar")
      ?.getBoundingClientRect().width;
    if (!initialWidth) return;
    sidebarResizeRef.current = { startX: event.clientX, initialWidth };
    const handleMove = (moveEvent: PointerEvent) => {
      const interaction = sidebarResizeRef.current;
      if (!interaction) return;
      const bodyWidth = containerRef.current
        ?.querySelector<HTMLElement>(".chat-explorer-body")
        ?.getBoundingClientRect().width;
      const maxWidth = Math.max(220, (bodyWidth ?? 600) - 220);
      const width = clamp(
        interaction.initialWidth + moveEvent.clientX - interaction.startX,
        170,
        maxWidth,
      );
      containerRef.current
        ?.querySelector<HTMLElement>(".chat-explorer-sidebar")
        ?.style.setProperty("width", `${width}px`);
    };
    const handleUp = () => {
      sidebarResizeRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  }

  const canOpenExplorer = Boolean(workspaceId) && !(isDefaultWorkspaceId(workspaceId) && !cwd);
  const canOpenTerminal = Boolean(cwd);

  function addWorkspaceExplorerTab(view: "files" | "git") {
    if (!canOpenExplorer) return;
    const existing = state.tabs.find(
      (tab) =>
        (tab.kind === "workspace" || tab.kind === "source" || tab.kind === "git-diff") &&
        tab.workspaceId === workspaceId,
    );
    if (existing) {
      onChange({
        ...state,
        activeTabId: existing.id,
        tabs: state.tabs.map((tab) =>
          tab.id === existing.id
            ? {
                ...tab,
                kind: "workspace" as const,
                cwd,
                explorerView: view,
                refreshToken: Date.now(),
              }
            : tab,
        ),
      });
      return;
    }
    const nextTab = {
      id: createChatWindowTabId(),
      title: "Explorer",
      kind: "workspace" as const,
      workspaceId,
      cwd,
      explorerView: view,
      refreshToken: Date.now(),
    };
    onChange({ ...state, tabs: [...state.tabs, nextTab], activeTabId: nextTab.id });
  }

  function addGitDiffTab() {
    addWorkspaceExplorerTab("git");
  }

  function addTerminalTab() {
    if (!cwd) return;
    const terminalCount = state.tabs.filter((tab) => tab.kind === "terminal").length;
    const nextTab: ChatWindowTab = {
      id: createChatWindowTabId(),
      title: terminalCount === 0 ? "Terminal" : `Terminal ${terminalCount + 1}`,
      kind: "terminal",
      workspaceId,
      cwd,
    };
    onChange({ ...state, tabs: [...state.tabs, nextTab], activeTabId: nextTab.id });
  }

  function addBrowserTab() {
    const nextTab: ChatWindowTab = {
      id: createChatWindowTabId(),
      title: "Browser",
      kind: "browser",
      url: "",
    };
    onChange({ ...state, tabs: [...state.tabs, nextTab], activeTabId: nextTab.id });
  }

  function navigateBrowser(url: string) {
    if (!browserTab) return;
    const nextNavigation = pushBrowserNavigation(browserTab, url);
    onChange({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === browserTab.id
          ? {
              ...tab,
              browserNavigation: nextNavigation,
              browserLoadUrl: url,
              title: getBrowserPreviewTitle(url),
              url,
              refreshToken: Date.now(),
            }
          : tab,
      ),
    });
  }

  function moveBrowser(offset: -1 | 1) {
    if (!browserTab) return;
    const next = moveBrowserNavigation(browserTab, offset);
    if (!next) return;
    onChange({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === browserTab.id
          ? {
              ...tab,
              browserNavigation: next.browserNavigation,
              browserLoadUrl: next.url,
              title: getBrowserPreviewTitle(next.url),
              url: next.url,
              refreshToken: Date.now(),
            }
          : tab,
      ),
    });
  }

  function refreshBrowser() {
    if (!browserTab?.url) return;
    onChange({
      ...state,
      tabs: state.tabs.map((tab) =>
        tab.id === browserTab.id
          ? { ...tab, browserLoadUrl: browserTab.url, refreshToken: Date.now() }
          : tab,
      ),
    });
  }

  function closeTab(tabId: string) {
    const closingTab = state.tabs.find((tab) => tab.id === tabId);
    if (closingTab?.kind === "terminal") {
      void terminalSessions
        .close(tabId)
        .catch((error) => console.error("Failed to close terminal session", error));
    }
    const nextTabs = state.tabs.filter((tab) => tab.id !== tabId);
    const nextActive =
      state.activeTabId === tabId
        ? (nextTabs[Math.max(0, state.tabs.findIndex((tab) => tab.id === tabId) - 1)]?.id ??
          nextTabs[0]?.id ??
          null)
        : state.activeTabId;
    onChange({ ...state, tabs: nextTabs, activeTabId: nextActive });
  }

  function closeAllTabs() {
    for (const tab of state.tabs) {
      if (tab.kind === "terminal") {
        void terminalSessions
          .close(tab.id)
          .catch((error) => console.error("Failed to close terminal session", error));
      }
    }
    onChange({ ...state, tabs: [], activeTabId: null });
  }

  function finishTabDrag() {
    draggedTabIdRef.current = null;
    setDraggedTabId(null);
    setTabDropTarget(null);
  }

  function beginTabDrag(event: ReactDragEvent<HTMLDivElement>, tabId: string) {
    event.stopPropagation();
    draggedTabIdRef.current = tabId;
    setDraggedTabId(tabId);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", tabId);
  }

  function updateTabDropTarget(event: ReactDragEvent<HTMLDivElement>, targetId: string) {
    const sourceId = draggedTabIdRef.current;
    if (!sourceId || sourceId === targetId) {
      setTabDropTarget(null);
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
    setTabDropTarget((current) =>
      current?.id === targetId && current.edge === edge ? current : { id: targetId, edge },
    );
  }

  function dropTab(event: ReactDragEvent<HTMLDivElement>, targetId: string) {
    event.preventDefault();
    event.stopPropagation();
    const sourceId = draggedTabIdRef.current;
    const draggedTab = state.tabs.find((tab) => tab.id === sourceId);
    if (!draggedTab || sourceId === targetId) {
      finishTabDrag();
      return;
    }

    const remainingTabs = state.tabs.filter((tab) => tab.id !== sourceId);
    const targetIndex = remainingTabs.findIndex((tab) => tab.id === targetId);
    if (targetIndex < 0) {
      finishTabDrag();
      return;
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const edge = event.clientX < bounds.left + bounds.width / 2 ? "before" : "after";
    remainingTabs.splice(targetIndex + (edge === "after" ? 1 : 0), 0, draggedTab);
    onChange({ ...state, tabs: remainingTabs });
    finishTabDrag();
  }

  return (
    <motion.div
      animate={
        split
          ? { flexBasis: expanded ? "100%" : `${state.splitRatio * 100}%`, opacity: 1 }
          : undefined
      }
      className={`chat-workspace-window ${split ? "is-split" : ""} ${expanded ? "is-expanded" : ""}`}
      exit={split ? { flexBasis: "0%", opacity: 0 } : undefined}
      initial={split && !shouldReduceMotion ? { flexBasis: "0%", opacity: 0 } : false}
      layout={!shouldReduceMotion}
      ref={containerRef}
      style={
        split
          ? { flexBasis: expanded ? "100%" : `${state.splitRatio * 100}%` }
          : { height: state.height, right: state.right, top: state.top, width: state.width }
      }
      transition={panelTransition}
    >
      <div
        className="chat-workspace-window-tabs"
        data-tauri-drag-region={split ? "deep" : undefined}
        onPointerDown={split ? undefined : (event) => beginInteraction(event, "move")}
        role="toolbar"
        aria-label="Chat 独立窗口"
      >
        <div className="chat-workspace-window-tab-list">
          {state.tabs.map((tab) => (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                {/* biome-ignore lint/a11y/noStaticElementInteractions: native tab drag-and-drop target; tab controls remain keyboard accessible */}
                <div
                  className={`chat-workspace-window-tab ${tab.id === state.activeTabId ? "is-active" : ""} ${draggedTabId === tab.id ? "is-dragging" : ""} ${tabDropTarget?.id === tab.id ? `is-drop-${tabDropTarget.edge}` : ""}`}
                  data-tauri-drag-region="false"
                  draggable
                  onDragEnd={finishTabDrag}
                  onDragOver={(event) => updateTabDropTarget(event, tab.id)}
                  onDragStart={(event) => beginTabDrag(event, tab.id)}
                  onDrop={(event) => dropTab(event, tab.id)}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  <button
                    className="chat-workspace-window-tab-select"
                    onClick={() => onChange({ ...state, activeTabId: tab.id })}
                    title={tab.title}
                    type="button"
                  >
                    {tab.kind === "terminal" ? <SquareTerminal className="size-3.5" /> : null}
                    {tab.kind === "browser" ? <Globe2 className="size-3.5" /> : null}
                    {tab.kind === "image" ? <Image className="size-3.5" /> : null}
                    {tab.kind === "plan" ? <ScrollText className="size-3.5" /> : null}
                    <span>{tab.title}</span>
                  </button>
                  <button
                    aria-label={`关闭${tab.title}`}
                    className="chat-workspace-window-tab-close"
                    onClick={() => closeTab(tab.id)}
                    type="button"
                  >
                    <X className="size-3" />
                  </button>
                  <span aria-hidden="true" className="chat-workspace-window-tab-drop-indicator" />
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
                <ContextMenuItem onSelect={() => closeTab(tab.id)}>
                  <X className="size-4" />
                  关闭
                </ContextMenuItem>
                <ContextMenuItem onSelect={closeAllTabs}>
                  <CopyX className="size-4" />
                  关闭所有
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          ))}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              aria-label="新建独立窗口标签页"
              className="chat-workspace-window-add"
              size="icon"
              title="新建标签页"
              type="button"
              variant="ghost"
            >
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" sideOffset={6}>
            <DropdownMenuItem disabled={!canOpenExplorer} onSelect={addGitDiffTab}>
              <FolderGit2 className="size-3.5" />
              Workspace Explorer
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canOpenTerminal} onSelect={addTerminalTab}>
              <SquareTerminal className="size-3.5" />
              Terminal
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={addBrowserTab}>
              <Globe2 className="size-3.5" />
              Browser
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          aria-label={expanded ? "恢复 Chat 独立窗口分栏" : "放大 Chat 独立窗口"}
          aria-pressed={expanded}
          className="chat-workspace-window-toggle"
          onClick={onToggleExpanded}
          size="icon"
          title={`${expanded ? "恢复分栏" : "放大窗口"}（${maximizeShortcut}）`}
          type="button"
          variant="ghost"
        >
          {expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </Button>
        <Button
          aria-label="关闭 Chat 独立窗口"
          className="chat-workspace-window-toggle"
          onClick={onToggle}
          size="icon"
          title={`关闭 Chat 独立窗口（${panelShortcut}）`}
          type="button"
          variant="ghost"
        >
          <PanelLeft className="size-4 rotate-180" />
        </Button>
      </div>
      {planTab ? (
        <div className="chat-explorer-shell">
          <header className="chat-explorer-toolbar">
            <span className="chat-explorer-title">{planTab.title}</span>
            <span className="chat-explorer-toolbar-actions">
              <span className="file-viewer-readonly">只读计划</span>
              {planTab.canExecute && planTab.sessionId && planTab.planId ? (
                <Button
                  className="!h-7 !gap-1.5 !px-2.5 !text-[11px]"
                  onClick={() =>
                    requestPlanExecution({
                      sessionId: planTab.sessionId ?? "",
                      planId: planTab.planId ?? "",
                    })
                  }
                  size="sm"
                  title="执行当前计划"
                  type="button"
                >
                  <Play className="size-3.5 fill-current" />
                  执行计划
                </Button>
              ) : null}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label="选择历史计划"
                    className="chat-workspace-window-add"
                    size="icon"
                    title="历史计划"
                    type="button"
                    variant="ghost"
                  >
                    <ScrollText className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={6}>
                  {planListQuery.isLoading ? (
                    <DropdownMenuItem disabled>加载中...</DropdownMenuItem>
                  ) : planListQuery.data?.length ? (
                    planListQuery.data.map((plan) => (
                      <DropdownMenuItem key={plan.id} onSelect={() => selectPlan(plan.id)}>
                        <ScrollText className="size-3.5" />
                        {plan.fileName}
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
                onClick={refreshPlan}
                size="icon"
                title="刷新计划"
                type="button"
                variant="ghost"
              >
                <RefreshCw className="size-4" />
              </Button>
            </span>
          </header>
          <div className="chat-explorer-editor-pane">
            <div className="chat-plan-preview">
              {viewerError ? (
                <div className="chat-workspace-window-empty text-destructive">{viewerError}</div>
              ) : planQuery.isLoading && planTab.content === undefined ? (
                <div aria-label="加载计划" className="chat-plan-preview-skeleton" role="status">
                  <span />
                  <span />
                  <span />
                  <span />
                </div>
              ) : (planTab.content ?? planQuery.data?.content ?? "").trim() ? (
                <div className="chat-message-text chat-plan-preview-content">
                  <ChatMarkdown isAnimating={false}>
                    {planTab.content ?? planQuery.data?.content ?? ""}
                  </ChatMarkdown>
                </div>
              ) : (
                <div className="chat-workspace-window-empty">计划正在生成...</div>
              )}
            </div>
          </div>
        </div>
      ) : workspaceTab ? (
        <div className="chat-explorer-shell">
          <header className="chat-explorer-toolbar">
            <span className="chat-explorer-title">
              {isGitWorkspace ? (gitSummary?.branch ?? "Explorer") : "Explorer"}
            </span>
            <span className="chat-explorer-toolbar-actions">
              {explorerView === "git" && isGitWorkspace ? (
                <span className="chat-explorer-totals">
                  +{gitSummary?.insertions ?? 0} -{gitSummary?.deletions ?? 0}
                </span>
              ) : null}
              {isGitWorkspace ? (
                <Button
                  aria-label="提交 Git 改动"
                  className="chat-workspace-window-add"
                  disabled={
                    !gitSummary || (!(gitSummary.files.length > 0) && gitSummary.ahead <= 0)
                  }
                  onClick={() => setCommitOpen(true)}
                  size="icon"
                  title="提交 Git 改动"
                  type="button"
                  variant="ghost"
                >
                  <Upload className="size-4" />
                </Button>
              ) : null}
              <Button
                aria-label="刷新 Explorer"
                className="chat-workspace-window-add"
                onClick={() => void refreshExplorer()}
                size="icon"
                title="刷新"
                type="button"
                variant="ghost"
              >
                <RefreshCw className="size-4" />
              </Button>
              {isGitWorkspace ? (
                <Button
                  aria-label="全部撤回 Git 改动"
                  className="chat-workspace-window-add"
                  disabled={restoreMutation.isPending || !(gitSummary?.files.length ?? 0)}
                  onClick={() => setRestoreTarget({ label: "全部 Git 改动" })}
                  size="icon"
                  title="全部撤回"
                  type="button"
                  variant="ghost"
                >
                  <Undo2 className="size-4" />
                </Button>
              ) : null}
            </span>
          </header>
          <div className="chat-explorer-body">
            <aside className="chat-explorer-sidebar">
              {isGitWorkspace ? (
                <div className="chat-explorer-view-tabs" role="tablist" aria-label="Explorer 视图">
                  <button
                    aria-selected={explorerView === "files"}
                    className={explorerView === "files" ? "is-active" : ""}
                    onClick={() => switchExplorerView("files")}
                    role="tab"
                    type="button"
                  >
                    <ExplorerFileIcon className="size-3.5" kind="files" />
                    文件
                  </button>
                  <button
                    aria-selected={explorerView === "git"}
                    className={explorerView === "git" ? "is-active" : ""}
                    onClick={() => switchExplorerView("git")}
                    role="tab"
                    type="button"
                  >
                    <ExplorerFileIcon className="size-3.5" kind="git" />
                    Git 改动{gitSummary?.filesChanged ? ` (${gitSummary.filesChanged})` : ""}
                  </button>
                </div>
              ) : null}
              <div className="chat-explorer-list">
                {explorerView !== "git" || !isGitWorkspace ? (
                  renderDirectory(".")
                ) : gitQuery.isLoading ? (
                  <div className="chat-explorer-skeleton-list">
                    {[0, 1, 2, 3].map((item) => (
                      <div className="chat-explorer-skeleton" key={item} />
                    ))}
                  </div>
                ) : gitSummary?.files.length ? (
                  gitSummary.files.map((file) => (
                    <div
                      className={`chat-explorer-row chat-explorer-git-row ${selectedPath === file.path ? "is-active" : ""}`}
                      key={file.path}
                    >
                      <button
                        className="chat-explorer-entry"
                        onClick={() => selectGitFile(file)}
                        type="button"
                      >
                        <span className={`chat-explorer-status is-${file.status}`}>
                          {file.status[0].toUpperCase()}
                        </span>
                        <span className="chat-explorer-git-file">
                          <span className="chat-explorer-git-file-name">
                            {pathBasename(file.path)}
                          </span>
                          {pathDirectory(file.path) ? (
                            <span className="chat-explorer-git-file-path">
                              {pathDirectory(file.path)}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <Button
                        aria-label={`撤回 ${file.path}`}
                        className="chat-explorer-restore"
                        disabled={restoreMutation.isPending}
                        onClick={() => restoreFile(file)}
                        size="icon"
                        title="撤回此文件"
                        type="button"
                        variant="ghost"
                      >
                        <Undo2 className="size-3" />
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="chat-explorer-empty">工作区没有 Git 改动</div>
                )}
              </div>
            </aside>
            <div
              aria-hidden="true"
              className="chat-explorer-sidebar-resize"
              onPointerDown={beginSidebarResize}
            />
            <section className="chat-explorer-editor-pane">
              {editorTabs.length > 0 ? (
                <div className="chat-explorer-editor-tabs" role="tablist" aria-label="打开的文件">
                  {editorTabs.map((tab) => (
                    <ContextMenu key={tab.path}>
                      <ContextMenuTrigger asChild>
                        <div
                          className={`chat-explorer-editor-tab ${tab.path === activeEditorPath && tab.mode === (editorContent?.mode ?? (explorerView === "git" ? "diff" : "source")) ? "is-active" : ""}`}
                        >
                          <button onClick={() => selectEditor(tab)} role="tab" type="button">
                            <ExplorerFileIcon
                              className="size-3.5"
                              kind={explorerFileIconKind(tab.path)}
                            />
                            {pathBasename(tab.path)}
                            {tab.mode === "diff" ? " · Diff" : ""}
                          </button>
                          <button
                            aria-label={`关闭 ${pathBasename(tab.path)}`}
                            onClick={() => closeEditor(tab.path)}
                            type="button"
                          >
                            <X className="size-3" />
                          </button>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent onCloseAutoFocus={(event) => event.preventDefault()}>
                        <ContextMenuItem onSelect={() => closeEditor(tab.path)}>
                          <X className="size-4" />
                          关闭标签页
                        </ContextMenuItem>
                        <ContextMenuItem onSelect={closeAllEditors}>
                          <CopyX className="size-4" />
                          关闭全部标签页
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </div>
              ) : null}
              <div className="chat-explorer-editor">{editorView}</div>
            </section>
          </div>
        </div>
      ) : terminalTab ? (
        <ChatTerminal cwd={terminalTab.cwd ?? cwd} sessionKey={terminalTab.id} />
      ) : browserTab ? (
        <ChatBrowser
          canGoBack={browserNavigation.index > 0}
          canGoForward={browserNavigation.index < browserNavigation.entries.length - 1}
          frameName={browserTab.id}
          loadUrl={browserTab.browserLoadUrl}
          onBack={() => moveBrowser(-1)}
          onForward={() => moveBrowser(1)}
          onNavigate={navigateBrowser}
          onRefresh={refreshBrowser}
          refreshToken={browserTab.refreshToken}
          url={browserTab.url}
        />
      ) : imageTab ? (
        <div className="chat-image-preview">
          {imageTab.url ? (
            <img alt={imageTab.title} src={imageTab.url} />
          ) : (
            <p className="chat-image-preview-empty">无图片</p>
          )}
        </div>
      ) : (
        <div className="chat-workspace-window-empty" aria-live="polite">
          <div className="chat-workspace-window-empty-guide">
            <h2>{state.tabs.length === 0 ? "窗口为空" : "空白占位窗口"}</h2>
            <p>
              {canOpenExplorer
                ? "浏览工作区、打开终端或预览网页。对话中打开的文件、计划和预览也会出现在这里。"
                : "当前对话没有可用工作区。可以先打开 Browser，或绑定工作区后再浏览文件。"}
            </p>
            <div className="chat-workspace-window-empty-actions">
              <Button
                disabled={!canOpenExplorer}
                onClick={() => addWorkspaceExplorerTab("files")}
                size="sm"
                title={canOpenExplorer ? "打开工作区 Explorer" : "当前对话没有可用工作区"}
                type="button"
                variant="outline"
              >
                <FolderGit2 className="size-3.5" />
                Explorer
              </Button>
              <Button
                disabled={!canOpenTerminal}
                onClick={addTerminalTab}
                size="sm"
                title={canOpenTerminal ? "打开 Terminal" : "当前对话没有工作目录"}
                type="button"
                variant="outline"
              >
                <SquareTerminal className="size-3.5" />
                Terminal
              </Button>
              <Button
                onClick={addBrowserTab}
                size="sm"
                title="打开 Browser"
                type="button"
                variant="outline"
              >
                <Globe2 className="size-3.5" />
                Browser
              </Button>
            </div>
          </div>
        </div>
      )}
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
      <AlertDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open && !restoreMutation.isPending) setRestoreTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>撤回 Git 改动？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要撤回“{restoreTarget?.label ?? "这些 Git 改动"}
              ”吗？此操作会丢弃未提交的修改，无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoreMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoreMutation.isPending}
              onClick={confirmRestore}
              variant="destructive"
            >
              {restoreMutation.isPending ? "撤回中..." : "撤回"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <GitCommitDialog
        open={commitOpen}
        onOpenChange={setCommitOpen}
        workspaceId={activeTabWorkspaceId ?? workspaceId}
        cwd={explorerCwd}
        branch={gitSummary?.branch}
        hasChanges={Boolean(gitSummary?.files.length)}
        canPush={Boolean(gitSummary?.ahead)}
        insertions={gitSummary?.insertions ?? 0}
        deletions={gitSummary?.deletions ?? 0}
        filesChanged={gitSummary?.filesChanged ?? 0}
        onSuccess={() => {
          void refreshExplorer();
        }}
      />
    </motion.div>
  );
}

function ChatSplitDivider({
  onChange,
  ratio,
}: {
  onChange: (ratio: number) => void;
  ratio: number;
}) {
  const shouldReduceMotion = Boolean(useReducedMotion());
  const dividerTransition = getWorkbenchMotionTransition(shouldReduceMotion);

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

  return (
    <motion.div
      animate={{ opacity: 1 }}
      aria-hidden="true"
      className="chat-split-divider"
      exit={{ opacity: 0 }}
      initial={shouldReduceMotion ? false : { opacity: 0 }}
      onPointerDown={startResize}
      transition={dividerTransition}
    />
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function TopActions({
  isPanelOpen,
  onTogglePanel,
  panelShortcut,
  showPanelToggle,
}: {
  isPanelOpen: boolean;
  onTogglePanel: () => void;
  panelShortcut: string;
  showPanelToggle: boolean;
}) {
  return (
    <div className="top-actions pointer-events-auto flex items-center gap-1.5 pr-3 text-muted-foreground max-sm:gap-0.5 max-sm:px-2">
      {showPanelToggle ? (
        <Button
          aria-label={isPanelOpen ? "关闭 Chat 独立窗口" : "打开 Chat 独立窗口"}
          aria-pressed={isPanelOpen}
          className="size-8"
          onClick={onTogglePanel}
          size="icon"
          title={`${isPanelOpen ? "关闭" : "打开"} Chat 独立窗口（${panelShortcut}）`}
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

type CommandMenuEntry =
  | { type: "chat"; chat: ChatIndexItem }
  | { type: "command"; command: CommandItem };

const CHAT_SEARCH_DEBOUNCE_MS = 500;

function useChatPaletteSearch(query: string) {
  const typedQuery = query.trim();
  const [debouncedQuery, setDebouncedQuery] = useState(typedQuery);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedQuery(typedQuery);
    }, CHAT_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [typedQuery]);

  const recentsQuery = useQuery({
    queryKey: ["chat-search", "recent"],
    queryFn: () => searchChatIndex({ limit: 9 }),
    enabled: typedQuery.length === 0,
  });
  const matchesQuery = useQuery({
    queryKey: ["chat-search", "match", debouncedQuery],
    queryFn: () => searchChatIndex({ query: debouncedQuery, limit: 10 }),
    enabled: debouncedQuery.length > 0,
  });

  if (typedQuery.length > 0) {
    const pending = typedQuery !== debouncedQuery || matchesQuery.isPending;
    return {
      pending,
      chats: pending ? [] : (matchesQuery.data ?? []),
      isError: matchesQuery.isError,
      hasQuery: true,
    };
  }

  return {
    pending: recentsQuery.isPending,
    chats: recentsQuery.data ?? [],
    isError: recentsQuery.isError,
    hasQuery: false,
  };
}

function CommandMenu({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const chatSearch = useChatPaletteSearch(query);
  const chats = chatSearch.chats;
  const commandMatches = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return commandItems;
    return commandItems.filter((item) =>
      [item.label, ...item.keywords].some((value) =>
        value.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [query]);
  const items = useMemo<CommandMenuEntry[]>(
    () => [
      ...chats.map((chat) => ({ type: "chat" as const, chat })),
      ...commandMatches.map((command) => ({ type: "command" as const, command })),
    ],
    [chats, commandMatches],
  );
  const resultCount = items.length;

  useEffect(() => inputRef.current?.focus(), []);

  function selectChat(item: ChatIndexItem) {
    navigate(chatSessionPath(item.id));
    onClose();
  }
  function selectCommand(item: CommandItem) {
    navigate(
      item.to === "/chat" ? chatNewPath() : item.to,
      item.to === "/chat" ? { state: chatNewNavigationState() } : undefined,
    );
    onClose();
  }
  function selectItem(item: CommandMenuEntry) {
    if (item.type === "chat") {
      selectChat(item.chat);
      return;
    }
    selectCommand(item.command);
  }
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const shortcutIndex = event.metaKey && /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
    if (shortcutIndex >= 0) {
      event.preventDefault();
      const chat = chats[shortcutIndex];
      if (chat) selectChat(chat);
      return;
    }
    if (event.key === "ArrowDown" && resultCount > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % resultCount);
    } else if (event.key === "ArrowUp" && resultCount > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + resultCount) % resultCount);
    } else if (event.key === "Enter" && items[activeIndex]) {
      event.preventDefault();
      selectItem(items[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  const showEmpty = !chatSearch.pending && resultCount === 0;

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
            aria-label="搜索聊天或菜单"
            autoCapitalize="none"
            autoCorrect="off"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="搜索聊天标题、内容或菜单..."
            ref={inputRef}
            spellCheck={false}
            value={query}
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>
        <div className="max-h-[min(55vh,360px)] overflow-y-auto p-2">
          {chatSearch.pending ? <ChatSearchSkeleton /> : null}
          {!chatSearch.pending && chatSearch.isError ? (
            <p className="px-3 py-2 text-center text-sm text-destructive">聊天记录加载失败</p>
          ) : null}
          {showEmpty ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {chatSearch.hasQuery ? "没有找到匹配结果" : "暂无结果"}
            </p>
          ) : (
            items.map((item, index) => {
              const isActive = activeIndex === index;
              if (item.type === "chat") {
                return (
                  <button
                    className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors ${isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"}`}
                    key={`chat:${item.chat.id}`}
                    onClick={() => selectChat(item.chat)}
                    onMouseEnter={() => setActiveIndex(index)}
                    type="button"
                  >
                    <MessageCircle className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">{item.chat.title}</span>
                    {index < 9 ? (
                      <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
                        ⌘{index + 1}
                      </kbd>
                    ) : null}
                  </button>
                );
              }
              const Icon = item.command.icon;
              return (
                <button
                  className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors ${isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"}`}
                  key={`command:${item.command.to}`}
                  onClick={() => selectCommand(item.command)}
                  onMouseEnter={() => setActiveIndex(index)}
                  type="button"
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="flex-1 truncate">{item.command.label}</span>
                  {isActive ? <CornerDownLeft className="size-3.5 opacity-70" /> : null}
                </button>
              );
            })
          )}
        </div>
        <footer className="flex items-center gap-4 border-border border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ArrowUp className="size-3" />
            <ArrowDown className="size-3" />
            切换
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="size-3" />
            打开
          </span>
        </footer>
      </section>
    </div>
  );
}

function ChatSearchMenu({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const chatSearch = useChatPaletteSearch(query);
  const matches = chatSearch.chats;
  const resultCount = matches.length;

  useEffect(() => inputRef.current?.focus(), []);

  function selectItem(item: ChatIndexItem) {
    navigate(chatSessionPath(item.id));
    onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    const shortcutIndex = event.metaKey && /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : -1;
    if (shortcutIndex >= 0) {
      event.preventDefault();
      const item = matches[shortcutIndex];
      if (item) selectItem(item);
    } else if (event.key === "ArrowDown" && resultCount > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % resultCount);
    } else if (event.key === "ArrowUp" && resultCount > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + resultCount) % resultCount);
    } else if (event.key === "Enter" && matches[activeIndex]) {
      event.preventDefault();
      selectItem(matches[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div
      aria-label="搜索聊天记录"
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
        aria-label="搜索聊天记录"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl"
        role="document"
      >
        <div className="flex h-14 items-center gap-3 border-border border-b px-4">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            aria-label="搜索聊天记录"
            autoCapitalize="none"
            autoCorrect="off"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="搜索聊天标题或内容"
            ref={inputRef}
            spellCheck={false}
            value={query}
          />
          <kbd className="hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
            ESC
          </kbd>
        </div>

        <div className="max-h-[min(55vh,360px)] overflow-y-auto p-2">
          {chatSearch.pending ? (
            <ChatSearchSkeleton />
          ) : chatSearch.isError ? (
            <p className="px-3 py-8 text-center text-sm text-destructive">聊天记录加载失败</p>
          ) : matches.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              {chatSearch.hasQuery ? "没有找到匹配的聊天" : "暂无聊天记录"}
            </p>
          ) : (
            matches.map((item, index) => {
              const isActive = activeIndex === index;
              return (
                <button
                  className={`flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors ${isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground"}`}
                  key={item.id}
                  onClick={() => selectItem(item)}
                  onMouseEnter={() => setActiveIndex(index)}
                  type="button"
                >
                  <MessageCircle className="size-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  {index < 9 ? (
                    <kbd className="hidden rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
                      ⌘{index + 1}
                    </kbd>
                  ) : null}
                </button>
              );
            })
          )}
        </div>

        <footer className="flex items-center gap-4 border-border border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <ArrowUp className="size-3" />
            <ArrowDown className="size-3" />
            切换
          </span>
          <span className="inline-flex items-center gap-1">
            <CornerDownLeft className="size-3" />
            打开
          </span>
        </footer>
      </section>
    </div>
  );
}

function ChatSearchSkeleton() {
  return (
    <div className="space-y-1" role="status" aria-label="正在搜索聊天记录">
      {[0, 1, 2, 3].map((index) => (
        <div className="flex h-11 items-center gap-3 rounded-md px-3" key={index}>
          <div className="size-4 animate-pulse rounded bg-muted" />
          <div className="h-3.5 w-3/4 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  );
}

export { AppShell };
