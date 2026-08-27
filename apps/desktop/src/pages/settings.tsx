import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Bell,
  Brain,
  ChartColumn,
  Check,
  CircleAlert,
  CircleCheck,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  FlaskConical,
  FolderOpen,
  Keyboard,
  KeyRound,
  LoaderCircle,
  MessageSquare,
  Package,
  Palette,
  Pencil,
  PlugZap,
  Plus,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Trash2,
  Waypoints,
  Wrench,
  X,
} from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import {
  NavLink,
  type NavLinkRenderProps,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ChatMemorySettings } from "@/components/chat-memory-settings";
import { ChatToolsSettings } from "@/components/chat-tools-settings";
import { type Theme, type ThemeColor, useTheme } from "@/components/theme-provider";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { getReturnPath } from "@/lib/app-return-path";
import {
  type ChatMemoryStore,
  DEFAULT_CHAT_MEMORY,
  loadChatMemory,
  saveChatMemory,
} from "@/lib/chat-memory";
import { compactChatMemory } from "@/lib/chat-memory-ops";
import type { ChatServerProviderModel } from "@/lib/chat-server";
import {
  canRestartChatServer,
  checkChatServer,
  importDeveloperEnvironment,
  listChatServerModels,
  loadChatServerConfig,
  loadChatServerPort,
  loadDeveloperEnvironment,
  loadFeishuChannelStatus,
  restartChatServer,
  saveChatServerConfig,
  saveFeishuChannelConfig,
  testChatServerModel,
  testFeishuChannel,
  updateChatServerPort,
} from "@/lib/chat-server";
import {
  type ChatDisplaySettings,
  DEFAULT_CHAT_DISPLAY,
  loadChatDisplaySettings,
  saveChatDisplaySettings,
} from "@/lib/chat-settings";
import {
  type ChatToolsSettings as ChatToolsSettingsValue,
  DEFAULT_CHAT_TOOLS,
  loadChatToolsSettings,
  saveChatToolsSettings,
} from "@/lib/chat-tools";
import {
  DEFAULT_DEVELOPER_SETTINGS,
  type DeveloperSettings,
  loadDeveloperSettings,
  saveDeveloperSettings,
} from "@/lib/developer-settings";
import {
  DEFAULT_GENERAL_SETTINGS,
  type GeneralSettings,
  loadGeneralSettings,
  requestNotificationPermission,
  saveGeneralSettings,
} from "@/lib/general-settings";
import { clearKieApiKey, loadKieApiKey, saveKieApiKey } from "@/lib/image-generation";
import {
  fetchMcpRegistry,
  loadMcpServers,
  type McpRegistryEntry,
  type McpServerConfig,
  saveMcpServers,
  testMcpConnection,
} from "@/lib/mcp";
import {
  formatModelContextSize,
  formatModelLabel,
  getDefaultModel,
  loadModels,
  type ModelConfig,
  saveModels,
  sortModelsByName,
} from "@/lib/models";
import { pickDirectory } from "@/lib/platform";
import {
  DEFAULT_SHORTCUTS,
  formatShortcut,
  loadShortcutSettings,
  type ShortcutAction,
  type ShortcutBinding,
  type ShortcutSettings,
  saveShortcutSettings,
  shortcutFromKeyboardEvent,
} from "@/lib/shortcuts";
import {
  loadAvailableSkills,
  loadDisabledSkillIds,
  type SkillDefinition,
  saveDisabledSkillIds,
} from "@/lib/skills";
import {
  clearSystemLogs,
  loadSystemLogs,
  type SystemLog,
  type SystemLogLevel,
} from "@/lib/system-log";

const themes: Array<{ value: Theme; label: string; description: string }> = [
  { value: "system", label: "跟随系统", description: "根据操作系统自动切换" },
  { value: "light", label: "浅色", description: "明亮、清晰的工作界面" },
  { value: "dark", label: "深色", description: "适合夜间和低光环境" },
];

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function stripSkillFrontmatter(content: string) {
  const lines = content.split(/\r?\n/);
  if (lines[0]?.trim() !== "---") return content;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index]?.trim() === "---") {
      return lines
        .slice(index + 1)
        .join("\n")
        .trimStart();
    }
  }
  return content;
}

const themeColors: Array<{
  value: ThemeColor;
  label: string;
  description: string;
  swatches: [string, string, string, string];
}> = [
  {
    value: "ocean",
    label: "海洋",
    description: "蓝色与青色",
    swatches: ["#3f9eb2", "#4678d5", "#7dd3fc", "#f29d78"],
  },
  {
    value: "gray",
    label: "灰白",
    description: "干净的中性灰白工作台",
    swatches: ["#f7f7f8", "#dfe1e5", "#9ca3af", "#4f5661"],
  },
  {
    value: "violet",
    label: "紫罗兰",
    description: "靛蓝与紫色",
    swatches: ["#635bdb", "#8b5cf6", "#a855f7", "#ec4899"],
  },
  {
    value: "sunset",
    label: "日落",
    description: "橙色与珊瑚色",
    swatches: ["#f97316", "#ef4444", "#fb7185", "#eab308"],
  },
  {
    value: "forest",
    label: "森林",
    description: "绿色与薄荷色",
    swatches: ["#16836b", "#22c55e", "#65a30d", "#14b8a6"],
  },
  {
    value: "solarized",
    label: "Solarized",
    description: "经典低对比度配色",
    swatches: ["#268bd2", "#2aa198", "#b58900", "#cb4b16"],
  },
  {
    value: "github",
    label: "GitHub",
    description: "蓝灰色的 GitHub 风格工作台",
    swatches: ["#0969da", "#1f883d", "#bf8700", "#8c959f"],
  },
  {
    value: "nord",
    label: "Nord",
    description: "冷静的蓝灰色调",
    swatches: ["#5e81ac", "#88c0d0", "#a3be8c", "#81a1c1"],
  },
  {
    value: "tokyo-night",
    label: "Tokyo Night",
    description: "蓝紫夜色工作台",
    swatches: ["#7aa2f7", "#bb9af7", "#f7768e", "#7dcfff"],
  },
  {
    value: "doom",
    label: "Doom",
    description: "高对比的深色编辑器风格",
    swatches: ["#51afef", "#c678dd", "#98be65", "#46d9ff"],
  },
  {
    value: "zenburn",
    label: "Zenburn",
    description: "低饱和的暖暗色调",
    swatches: ["#dcdccc", "#8fb28f", "#93e0e3", "#cc9393"],
  },
  {
    value: "tomorrow",
    label: "Tomorrow",
    description: "干净的日间与夜间中性色",
    swatches: ["#4271ae", "#e0e0e0", "#b5bd68", "#de935f"],
  },
  {
    value: "modus",
    label: "Modus",
    description: "高可读性的中性高对比主题",
    swatches: ["#005f9f", "#7fcfff", "#d9f0ff", "#ff7b7b"],
  },
  {
    value: "spacemacs",
    label: "Spacemacs",
    description: "紫色与青绿色的组合",
    swatches: ["#ae81ff", "#f92672", "#4db6ac", "#66d9ef"],
  },
  {
    value: "monokai",
    label: "Monokai",
    description: "经典霓虹深色配色",
    swatches: ["#f92672", "#a6e22e", "#66d9ef", "#fd971f"],
  },
  {
    value: "gruvbox",
    label: "Gruvbox",
    description: "温暖的棕橙与墨绿",
    swatches: ["#fabd2f", "#458588", "#b16286", "#83a598"],
  },
  {
    value: "dracula",
    label: "Dracula",
    description: "紫粉与荧光绿的暗色主题",
    swatches: ["#bd93f9", "#50fa7b", "#ff79c6", "#6272a4"],
  },
  {
    value: "material",
    label: "Material",
    description: "蓝灰色的 Material 风格",
    swatches: ["#82aaff", "#c3e88d", "#89ddff", "#ff5370"],
  },
  {
    value: "moe",
    label: "Moe",
    description: "柔和而多彩的深色主题",
    swatches: ["#4db6ac", "#3f51b5", "#ffb74d", "#ba68c8"],
  },
  {
    value: "cyberpunk",
    label: "Cyberpunk",
    description: "霓虹感更强的高饱和配色",
    swatches: ["#ff4fd8", "#00e5ff", "#f7ff00", "#8c5cff"],
  },
  {
    value: "kaolin",
    label: "Kaolin",
    description: "浅色与深色都偏柔和的编辑器风格",
    swatches: ["#6c71c4", "#88c0d0", "#b48ead", "#d16d9e"],
  },
  {
    value: "mint",
    label: "薄荷",
    description: "轻盈的绿色与水色",
    swatches: ["#0f9f8f", "#47c6a8", "#8abf4f", "#c4f1e8"],
  },
  {
    value: "ruby",
    label: "宝石红",
    description: "红色与莓果强调",
    swatches: ["#c43f5b", "#e85d75", "#7c5cff", "#f59e0b"],
  },
];

function SettingsLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHistoryRoute = location.pathname.startsWith("/settings/history");

  return (
    <div
      className={`settings-page ${
        isHistoryRoute
          ? "flex h-full min-h-0 w-full overflow-hidden bg-background"
          : "flex min-h-full w-full bg-background"
      }`}
    >
      <aside className="app-shell-sidebar sticky top-0 flex h-screen w-[248px] shrink-0 flex-col border-border border-r px-4 pt-8 max-md:w-[220px] max-sm:w-[76px] max-sm:px-2">
        <Button
          aria-label="返回应用"
          className="mb-3 h-8 justify-start gap-2 px-2 text-muted-foreground text-sm hover:text-foreground max-sm:justify-center max-sm:px-0"
          onClick={() => navigate(getReturnPath())}
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="size-4" />
          <span className="max-sm:hidden">返回应用</span>
        </Button>
        <div className="mb-4 flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] text-muted-foreground shadow-xs">
          <Search className="size-4 shrink-0" />
          <span className="max-sm:hidden">搜索设置...</span>
        </div>
        <p className="px-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wider max-sm:hidden">
          工作区
        </p>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="设置导航">
          <SettingsNavItem to="/settings/general" icon={Bell} label="常规" />
          <SettingsNavItem to="/settings/channel" icon={MessageSquare} label="Channel" />
          <SettingsNavItem to="/settings/theme" icon={Palette} label="主题" />
          <SettingsNavItem to="/settings/shortcuts" icon={Keyboard} label="快捷键" />
          <SettingsNavItem to="/settings/models" icon={Package} label="模型" />
          <SettingsNavItem to="/settings/mcp" icon={PlugZap} label="MCP" />
          <SettingsNavItem to="/settings/skills" icon={Sparkles} label="Skills" />
          <SettingsNavItem to="/settings/tools" icon={Wrench} label="Tools" />
          <SettingsNavItem to="/settings/sandbox" icon={ShieldCheck} label="沙箱" />
          <SettingsNavItem to="/settings/environment" icon={SquareTerminal} label="环境" />
          <SettingsNavItem to="/settings/development" icon={FlaskConical} label="开发" />
          <SettingsNavItem to="/settings/memory" icon={Brain} label="长期记忆" />
          <SettingsNavItem to="/settings/keys" icon={KeyRound} label="API Keys" />
          <SettingsNavItem to="/settings/chat-server" icon={Server} label="Chat Server" />
          <SettingsNavItem to="/settings/statistics" icon={ChartColumn} label="使用量" />
          <SettingsNavItem to="/settings/logs" icon={ScrollText} label="活动记录" />
        </nav>
        <div className="mt-3 border-border border-t py-3 text-[11px] text-muted-foreground max-sm:hidden">
          ChatDesk
          <span className="mt-1 block opacity-60">本地工作区设置</span>
        </div>
      </aside>
      {isHistoryRoute ? (
        <main className="app-shell-content flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      ) : (
        <main className="app-shell-content min-w-0 flex-1 px-8 pt-16 pb-14 sm:px-12 lg:px-20">
          <div className="mx-auto w-full max-w-3xl">
            <Outlet />
          </div>
        </main>
      )}
    </div>
  );
}

const logLevelLabels: Record<SystemLogLevel, string> = {
  info: "信息",
  success: "成功",
  warning: "警告",
  error: "错误",
};

const logLevelClasses: Record<SystemLogLevel, string> = {
  info: "bg-accent text-muted-foreground",
  success: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/12 text-amber-700 dark:text-amber-300",
  error: "bg-destructive/12 text-destructive",
};

function SystemLogsSettingsPage() {
  const queryClient = useQueryClient();
  const [level, setLevel] = useState<"all" | SystemLogLevel>("all");
  const logsQuery = useQuery({ queryKey: ["system-logs"], queryFn: loadSystemLogs });
  const clearMutation = useMutation({
    mutationFn: clearSystemLogs,
    onSuccess: () => queryClient.setQueryData<SystemLog[]>(["system-logs"], []),
  });
  const logs = (logsQuery.data ?? []).filter((log) => level === "all" || log.level === level);

  return (
    <>
      <SettingsHeading
        eyebrow="System"
        title="活动记录"
        description="查看最近的应用运行记录，帮助定位设置保存、窗口状态和连接问题。"
      />
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-center justify-between gap-3 border-border border-b px-5 py-4">
          <div>
            <h2 className="font-medium text-sm">最近记录</h2>
            <p className="mt-1 text-muted-foreground text-xs">
              保留最近 200 条记录，仅存储在当前设备。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Select
              onValueChange={(value) => setLevel(value as "all" | SystemLogLevel)}
              value={level}
            >
              <SelectTrigger aria-label="按级别筛选记录" className="w-[112px] text-xs" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部级别</SelectItem>
                {(Object.keys(logLevelLabels) as SystemLogLevel[]).map((item) => (
                  <SelectItem key={item} value={item}>
                    {logLevelLabels[item]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              aria-label="刷新活动记录"
              disabled={logsQuery.isFetching}
              onClick={() => void logsQuery.refetch()}
              size="icon"
              type="button"
              variant="outline"
            >
              <RefreshCw className={logsQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
            </Button>
            <Button
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={clearMutation.isPending || (logsQuery.data?.length ?? 0) === 0}
              onClick={() => void clearMutation.mutateAsync()}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2 className="size-3.5" /> 清空
            </Button>
          </div>
        </div>
        {logsQuery.isPending ? (
          <div className="space-y-3 p-5" aria-busy="true" role="status">
            <div className="h-16 animate-pulse rounded-md bg-accent" />
            <div className="h-16 animate-pulse rounded-md bg-accent" />
            <div className="h-16 animate-pulse rounded-md bg-accent" />
          </div>
        ) : logsQuery.isError ? (
          <div className="px-5 py-14 text-center">
            <p className="font-medium text-sm">读取活动记录失败</p>
            <p className="mt-1 text-muted-foreground text-xs">请点击右上角刷新后重试。</p>
          </div>
        ) : logs.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <ScrollText className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-medium text-sm">暂无活动记录</p>
            <p className="mt-1 text-muted-foreground text-xs">应用运行后，相关记录会显示在这里。</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {logs.map((log) => (
              <SystemLogRow key={log.id} log={log} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function SystemLogRow({ log }: { log: SystemLog }) {
  return (
    <article className="flex gap-3 px-5 py-4 transition-colors hover:bg-accent/30">
      <span
        className={`mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full px-2 text-[10px] font-medium ${logLevelClasses[log.level]}`}
      >
        {logLevelLabels[log.level]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h3 className="font-medium text-sm">{log.message}</h3>
          <time className="font-mono text-[11px] text-muted-foreground" dateTime={log.timestamp}>
            {formatLogTime(log.timestamp)}
          </time>
        </div>
        <p className="mt-1 text-muted-foreground text-xs">
          {log.source}
          {log.details ? ` · ${log.details}` : ""}
        </p>
      </div>
    </article>
  );
}

function formatLogTime(timestamp: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" }).format(
    new Date(timestamp),
  );
}

function SettingsNavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: typeof Palette;
  label: string;
}) {
  return (
    <NavLink
      className={({ isActive }: NavLinkRenderProps) =>
        `sidebar-nav-item flex h-8 items-center gap-2 px-3 text-[13px] transition-colors max-sm:justify-center max-sm:px-0 ${isActive ? "is-active font-medium" : ""}`
      }
      to={to}
    >
      <Icon className="size-4" />
      <span className="max-sm:hidden">{label}</span>
    </NavLink>
  );
}

function SettingsHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <header className="mb-8">
      <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
        {eyebrow}
      </p>
      <h1 className="mt-2 font-semibold text-3xl tracking-tight">{title}</h1>
      <p className="mt-2 max-w-xl text-muted-foreground text-sm leading-6">{description}</p>
    </header>
  );
}

function ThemeSettingsPage() {
  const { theme, setTheme, themeColor, setThemeColor } = useTheme();
  const [chatDisplay, setChatDisplay] = useState<ChatDisplaySettings>(DEFAULT_CHAT_DISPLAY);

  useEffect(() => {
    void loadChatDisplaySettings().then(setChatDisplay);
  }, []);

  const updateChatDisplay = (next: ChatDisplaySettings) => {
    setChatDisplay(next);
    void saveChatDisplaySettings(next).catch((error) =>
      console.error("Failed to save chat display settings", error),
    );
  };

  return (
    <>
      <SettingsHeading
        eyebrow="Appearance"
        title="主题"
        description="选择 ChatDesk 的显示方式，设置会在所有页面立即生效。"
      />
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">界面主题</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            你可以随时切换，也可以让它跟随系统偏好。
          </p>
        </div>
        <RadioGroup
          className="divide-y divide-border"
          onValueChange={(value) => setTheme(value as Theme)}
          value={theme}
        >
          {themes.map((item) => (
            <div
              className="flex items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-accent/40"
              key={item.value}
            >
              <label className="min-w-0 flex-1 cursor-pointer" htmlFor={`theme-${item.value}`}>
                <span className="block font-medium text-sm">{item.label}</span>
                <span className="mt-1 block text-muted-foreground text-xs">{item.description}</span>
              </label>
              <RadioGroupItem id={`theme-${item.value}`} value={item.value} />
            </div>
          ))}
        </RadioGroup>
      </section>
      <section className="mt-5 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">主题颜色</h2>
          <p className="mt-1 text-muted-foreground text-xs">选择一组颜色作为界面的主色和强调色。</p>
        </div>
        <RadioGroup
          className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3"
          onValueChange={(value) => setThemeColor(value as ThemeColor)}
          value={themeColor}
        >
          {themeColors.map((item) => (
            <label
              className="flex cursor-pointer items-center gap-3 rounded-md border border-border px-3 py-3 transition-colors hover:border-primary/50 hover:bg-accent/35 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/8"
              htmlFor={`theme-color-${item.value}`}
              key={item.value}
            >
              <RadioGroupItem id={`theme-color-${item.value}`} value={item.value} />
              <span className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex shrink-0 gap-1" aria-hidden="true">
                  {item.swatches.map((color) => (
                    <span
                      className="size-4 rounded-full ring-1 ring-black/10"
                      key={color}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </span>
                <span className="min-w-0">
                  <span className="block font-medium text-sm">{item.label}</span>
                  <span className="mt-0.5 block truncate text-muted-foreground text-xs">
                    {item.description}
                  </span>
                </span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </section>
      <section className="mt-5 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">对话字体</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            使用系统自带字体优化中文、英文、代码和数学公式的阅读体验。
          </p>
        </div>
        <div className="divide-y divide-border">
          <ChatFontSettingRow
            description="系统 UI 字体，自动适配当前平台的中文和英文"
            label="正文（中文 / 英文）"
            onChange={(value) => updateChatDisplay({ ...chatDisplay, bodyFont: value })}
            options={[
              { value: "system", label: "系统默认" },
              { value: "pingfang", label: "苹方 PingFang SC" },
              { value: "hiragino", label: "冬青黑体 Hiragino" },
              { value: "segoe", label: "Segoe UI" },
              { value: "noto", label: "Noto Sans" },
              { value: "inter", label: "Inter" },
              { value: "serif", label: "Georgia / 宋体" },
            ]}
            value={chatDisplay.bodyFont}
          />
          <ChatFontSettingRow
            description="用于代码块、内联代码和路径"
            label="代码"
            onChange={(value) => updateChatDisplay({ ...chatDisplay, codeFont: value })}
            options={[
              { value: "system", label: "系统等宽字体" },
              { value: "sf-mono", label: "SF Mono" },
              { value: "menlo", label: "Menlo" },
              { value: "cascadia", label: "Cascadia Code" },
              { value: "consolas", label: "Consolas" },
              { value: "courier", label: "Courier New" },
            ]}
            value={chatDisplay.codeFont}
          />
          <ChatFontSettingRow
            description="用于 KaTeX 数学公式的字形"
            label="数学公式"
            onChange={(value) => updateChatDisplay({ ...chatDisplay, mathFont: value })}
            options={[
              { value: "katex", label: "KaTeX 默认" },
              { value: "cambria", label: "Cambria Math" },
              { value: "stix", label: "STIX Two Math" },
              { value: "times", label: "Times New Roman" },
            ]}
            value={chatDisplay.mathFont}
          />
        </div>
      </section>
    </>
  );
}

function GeneralSettingsPage() {
  const [settings, setSettings] = useState<GeneralSettings>(DEFAULT_GENERAL_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    void loadGeneralSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .catch(() => {
        if (active) setNotice("读取常规设置失败，请重试。");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleNotificationsChange(enabled: boolean) {
    const previous = settings.notifyOnChatCompletion;
    setNotice("");
    if (enabled && !(await requestNotificationPermission())) {
      setNotice(
        "系统未能显示通知，请在系统设置中允许 ChatDesk 发送通知。macOS 开发构建还需要完成代码签名。",
      );
      return;
    }
    const next = {
      ...settings,
      notifyOnChatCompletion: enabled,
      notificationPermissionVerified: enabled || settings.notificationPermissionVerified,
    };
    setSettings(next);
    setIsSaving(true);
    try {
      await saveGeneralSettings(next);
      if (enabled) setNotice("通知已开启，并已发送一条验证通知。");
    } catch {
      setSettings({ ...settings, notifyOnChatCompletion: previous });
      setNotice("保存通知设置失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleUnfocusedOnlyChange(enabled: boolean) {
    const next = { ...settings, notifyOnlyWhenWindowUnfocused: enabled };
    setSettings(next);
    setIsSaving(true);
    setNotice("");
    try {
      await saveGeneralSettings(next);
    } catch {
      setSettings(settings);
      setNotice("保存通知设置失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      <SettingsHeading
        eyebrow="General"
        title="常规"
        description="管理 ChatDesk 的通用行为和通知偏好。"
      />
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">通知设置</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            控制对话完成时是否发送系统通知，以及何时发送。
          </p>
        </div>
        <label
          className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-accent/40"
          htmlFor="notify-chat-completion"
        >
          <span className="min-w-0">
            <span className="block font-medium text-sm">对话完成时显示通知</span>
            <span className="mt-1 block text-muted-foreground text-xs">
              仅在系统已授予 ChatDesk 通知权限时生效。
            </span>
          </span>
          <Switch
            aria-label="对话完成时显示通知"
            checked={settings.notifyOnChatCompletion}
            disabled={isLoading || isSaving}
            id="notify-chat-completion"
            onCheckedChange={(checked) => void handleNotificationsChange(checked === true)}
          />
        </label>
        <label
          className="flex cursor-pointer items-center justify-between gap-4 border-border border-t px-5 py-4 transition-colors hover:bg-accent/40"
          htmlFor="notify-feishu-message"
        >
          <span className="min-w-0">
            <span className="block font-medium text-sm">收到飞书消息时显示通知</span>
            <span className="mt-1 block text-muted-foreground text-xs">
              仅在系统已授予 ChatDesk 通知权限时生效。
            </span>
          </span>
          <Switch
            aria-label="收到飞书消息时显示通知"
            checked={settings.notifyOnFeishuMessage}
            disabled={isLoading || isSaving}
            id="notify-feishu-message"
            onCheckedChange={(checked) => {
              const next = { ...settings, notifyOnFeishuMessage: checked === true };
              setSettings(next);
              setIsSaving(true);
              void saveGeneralSettings(next)
                .catch(() => setNotice("保存通知设置失败，请重试。"))
                .finally(() => setIsSaving(false));
            }}
          />
        </label>
        <label
          className="flex cursor-pointer items-center justify-between gap-4 border-border border-t px-5 py-4 transition-colors hover:bg-accent/40"
          htmlFor="notify-chat-completion-unfocused"
        >
          <span className="min-w-0">
            <span className="block font-medium text-sm">窗口非聚焦时才发送</span>
            <span className="mt-1 block text-muted-foreground text-xs">
              ChatDesk 窗口处于后台或失去焦点时才显示完成通知。
            </span>
          </span>
          <Switch
            aria-label="窗口非聚焦时才发送通知"
            checked={settings.notifyOnlyWhenWindowUnfocused}
            disabled={isLoading || isSaving || !settings.notifyOnChatCompletion}
            id="notify-chat-completion-unfocused"
            onCheckedChange={(checked) => void handleUnfocusedOnlyChange(checked === true)}
          />
        </label>
        {notice ? (
          <p className="border-border border-t px-5 py-3 text-muted-foreground text-xs">{notice}</p>
        ) : null}
      </section>
    </>
  );
}

function FeishuChannelSettingsPage() {
  const statusQuery = useQuery({
    queryKey: ["feishu-status"],
    queryFn: () => loadFeishuChannelStatus(),
  });
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const save = useMutation({
    mutationFn: () => saveFeishuChannelConfig({ appId, appSecret }),
    onSuccess: () => void statusQuery.refetch(),
  });
  const test = useMutation({
    mutationFn: () => testFeishuChannel(),
    onSuccess: () => void statusQuery.refetch(),
  });
  return (
    <>
      <SettingsHeading
        eyebrow="Channel"
        title="飞书"
        description="连接飞书机器人，接收单聊消息并在 ChatDesk 中回复。"
      />
      <section className="space-y-4 rounded-lg border border-border bg-card p-5">
        <div className="grid gap-3">
          <label className="text-sm" htmlFor="feishu-app-id">
            App ID
            <Input
              id="feishu-app-id"
              value={appId}
              onChange={(event) => setAppId(event.target.value)}
              placeholder="cli_..."
            />
          </label>
          <label className="text-sm" htmlFor="feishu-app-secret">
            App Secret
            <Input
              id="feishu-app-secret"
              type="password"
              value={appSecret}
              onChange={(event) => setAppSecret(event.target.value)}
            />
          </label>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={save.isPending || !appId.trim() || !appSecret.trim()}
            onClick={() => void save.mutateAsync()}
          >
            保存
          </Button>
          <Button
            disabled={test.isPending || !statusQuery.data?.configured}
            onClick={() => void test.mutateAsync()}
            variant="outline"
          >
            测试连接
          </Button>
        </div>
        <div className="border-border border-t pt-4 text-sm">
          <p>连接状态：{statusQuery.data?.status ?? "未配置"}</p>
          {statusQuery.data?.botName ? (
            <p className="mt-1 text-muted-foreground text-xs">机器人：{statusQuery.data.botName}</p>
          ) : null}
          {statusQuery.data?.lastError ? (
            <p className="mt-1 text-destructive text-xs">{statusQuery.data.lastError}</p>
          ) : null}
        </div>
      </section>
    </>
  );
}

function DevelopmentSettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["developer-settings"],
    queryFn: loadDeveloperSettings,
  });
  const settings = settingsQuery.data ?? DEFAULT_DEVELOPER_SETTINGS;
  const saveMutation = useMutation({
    mutationFn: saveDeveloperSettings,
    onSuccess: (_result, next: DeveloperSettings) => {
      queryClient.setQueryData(["developer-settings"], next);
    },
  });

  function updateMockLongResponse(enabled: boolean) {
    saveMutation.mutate({ ...settings, mockLongResponse: enabled });
  }

  return (
    <>
      <SettingsHeading
        eyebrow="Development"
        title="开发"
        description="管理仅用于本地开发和性能验证的实验能力。"
      />
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">响应测试</h2>
          <p className="mt-1 text-muted-foreground text-xs">
            使用本地生成的数据验证聊天渲染，不产生模型用量。
          </p>
        </div>
        <label
          className="flex cursor-pointer items-center justify-between gap-4 px-5 py-4 transition-colors hover:bg-accent/40"
          htmlFor="mock-long-response"
        >
          <span className="min-w-0">
            <span className="block font-medium text-sm">长文本 Mock 回复</span>
            <span className="mt-1 block text-muted-foreground text-xs">
              开启后，新回复会由 Chat Server 高频流式输出长 Markdown，不调用真实模型。
            </span>
          </span>
          <Switch
            aria-label="长文本 Mock 回复"
            checked={settings.mockLongResponse}
            disabled={settingsQuery.isPending || saveMutation.isPending}
            id="mock-long-response"
            onCheckedChange={(checked) => updateMockLongResponse(checked === true)}
          />
        </label>
        {saveMutation.isError ? (
          <p className="border-border border-t px-5 py-3 text-destructive text-xs">
            保存开发设置失败，请重试。
          </p>
        ) : null}
      </section>
    </>
  );
}

function ChatFontSettingRow<T extends string>({
  description,
  label,
  onChange,
  options,
  value,
}: {
  description: string;
  label: string;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
  value: T;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
      <div className="min-w-0">
        <p className="font-medium text-sm">{label}</p>
        <p className="mt-1 text-muted-foreground text-xs">{description}</p>
      </div>
      <Select onValueChange={(next) => onChange(next as T)} value={value}>
        <SelectTrigger aria-label={`${label}字体`} className="w-[190px]" size="sm">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function ShortcutsSettingsPage() {
  const [settings, setSettings] = useState<ShortcutSettings>(DEFAULT_SHORTCUTS);
  const [isLoading, setIsLoading] = useState(true);
  const [editing, setEditing] = useState<ShortcutAction | null>(null);

  useEffect(() => {
    let active = true;
    void loadShortcutSettings()
      .then((value) => {
        if (active) setSettings(value);
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const updateShortcut = useCallback(
    (action: ShortcutAction, binding: ShortcutBinding) => {
      const next = { ...settings, [action]: binding };
      setSettings(next);
      void saveShortcutSettings(next);
    },
    [settings],
  );

  useEffect(() => {
    if (!editing) return;
    const action = editing;

    function handleShortcutKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setEditing(null);
        return;
      }
      const next = shortcutFromKeyboardEvent(event);
      if (!next) return;
      event.preventDefault();
      event.stopPropagation();
      updateShortcut(action, next);
      setEditing(null);
    }

    window.addEventListener("keydown", handleShortcutKeyDown, true);
    return () => window.removeEventListener("keydown", handleShortcutKeyDown, true);
  }, [editing, updateShortcut]);

  const items: Array<{ action: ShortcutAction; label: string; description: string }> = [
    {
      action: "mainSidebar",
      label: "左侧 Sidebar",
      description: "展开或收起应用左侧 Sidebar。",
    },
    {
      action: "chatSidebar",
      label: "Chat 侧边栏按钮",
      description: "打开 Chat 右侧独立窗口。",
    },
    {
      action: "chatSidebarMaximize",
      label: "Chat 侧边栏最大按钮",
      description: "在分栏与最大化窗口之间切换。",
    },
    {
      action: "newConversation",
      label: "新建对话",
      description: "在当前 Workspace 中创建一个新的 Chat 对话。",
    },
    {
      action: "previousConversation",
      label: "上一条对话",
      description: "切换到侧栏中更靠上的对话。",
    },
    {
      action: "nextConversation",
      label: "下一条对话",
      description: "切换到侧栏中更靠下的对话。",
    },
  ];

  return (
    <>
      <SettingsHeading
        eyebrow="Navigation"
        title="快捷键"
        description="为常用的 Chat 窗口操作设置键盘组合键。点击快捷键后直接按下新的组合键即可。快捷键使用物理按键识别，适配 macOS Option 键产生的字符变化。"
      />
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">Chat 窗口</h2>
          <p className="mt-1 text-muted-foreground text-xs">快捷键仅在 Chat 页面生效。</p>
        </div>
        <div className="divide-y divide-border">
          {items.map((item) => {
            const isEditing = editing === item.action;
            const binding = settings[item.action];
            return (
              <div
                className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                key={item.action}
              >
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{item.label}</p>
                  <p className="mt-1 text-muted-foreground text-xs">{item.description}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    aria-label={`设置${item.label}快捷键`}
                    className={`min-w-24 rounded-md border px-3 py-1.5 text-center font-medium text-[13px] tracking-[0.02em] transition-colors ${isEditing ? "border-primary bg-primary/10 text-foreground" : "border-border bg-background text-foreground hover:bg-accent"}`}
                    disabled={isLoading}
                    onClick={() => setEditing(item.action)}
                    type="button"
                  >
                    {isEditing ? "按下快捷键" : formatShortcut(binding)}
                  </button>
                  <Button
                    aria-label={`恢复${item.label}默认快捷键`}
                    onClick={() => updateShortcut(item.action, DEFAULT_SHORTCUTS[item.action])}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    恢复默认
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}

function MemorySettingsPage() {
  const queryClient = useQueryClient();
  const modelsQuery = useQuery({
    queryKey: ["models"],
    queryFn: loadModels,
  });
  const memoryQuery = useQuery({
    queryKey: ["chat-memory"],
    queryFn: loadChatMemory,
  });
  const store = memoryQuery.data ?? DEFAULT_CHAT_MEMORY;
  const defaultModel = getDefaultModel(modelsQuery.data ?? []);

  function handleStoreChange(next: ChatMemoryStore) {
    queryClient.setQueryData(["chat-memory"], next);
    void saveChatMemory(next).catch((error) => console.error("Failed to save chat memory", error));
  }

  async function handleCompact() {
    if (!defaultModel) {
      throw new Error("请先在“模型”设置中选择默认模型，再整理长期记忆。");
    }
    const next = await compactChatMemory(defaultModel);
    queryClient.setQueryData(["chat-memory"], next);
  }

  return (
    <>
      <SettingsHeading
        eyebrow="Chat"
        title="长期记忆"
        description="全局共享的用户记忆，开启后会自动抽取并在后续对话中使用。"
      />
      <section className="rounded-lg border border-border bg-card px-5 py-5">
        {memoryQuery.isPending ? (
          <div className="space-y-4" aria-busy="true" role="status">
            <div className="h-14 animate-pulse rounded-md bg-accent" />
            <div className="h-20 animate-pulse rounded-md bg-accent" />
            <div className="h-28 animate-pulse rounded-md bg-accent" />
          </div>
        ) : memoryQuery.isError ? (
          <div className="py-10 text-center">
            <p className="font-medium text-sm">读取记忆设置失败</p>
            <p className="mt-1 text-muted-foreground text-xs">请刷新页面后重试。</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <ChatMemorySettings
              compactDisabled={modelsQuery.isPending}
              idPrefix="settings-memory"
              onCompact={handleCompact}
              store={store}
              onStoreChange={handleStoreChange}
            />
          </div>
        )}
      </section>
    </>
  );
}

function ToolsSettingsPage() {
  const queryClient = useQueryClient();
  const toolsQuery = useQuery({
    queryKey: ["chat-tools"],
    queryFn: loadChatToolsSettings,
  });
  const settings = toolsQuery.data ?? DEFAULT_CHAT_TOOLS;

  function handleSettingsChange(next: ChatToolsSettingsValue) {
    queryClient.setQueryData(["chat-tools"], next);
    void saveChatToolsSettings(next).catch((error) =>
      console.error("Failed to save chat tools settings", error),
    );
  }

  return (
    <>
      <SettingsHeading
        eyebrow="Chat"
        title="Tools"
        description="配置 Chat 可调用的本地开发、终端、联网创作和业务数据工具包。"
      />
      <section className="rounded-lg border border-border bg-card px-5 py-5">
        {toolsQuery.isPending ? (
          <div className="space-y-4" aria-busy="true" role="status">
            <div className="h-14 animate-pulse rounded-md bg-accent" />
            <div className="h-28 animate-pulse rounded-md bg-accent" />
            <div className="h-28 animate-pulse rounded-md bg-accent" />
          </div>
        ) : toolsQuery.isError ? (
          <div className="py-10 text-center">
            <p className="font-medium text-sm">读取 Tools 设置失败</p>
            <p className="mt-1 text-muted-foreground text-xs">请刷新页面后重试。</p>
          </div>
        ) : (
          <ChatToolsSettings
            idPrefix="settings-tools"
            settings={settings}
            onSettingsChange={handleSettingsChange}
          />
        )}
      </section>
    </>
  );
}

function SandboxSettingsPage() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["chat-server-chat-config"],
    queryFn: () => loadChatServerConfig(),
  });
  const [draft, setDraft] = useState<string[]>([]);
  const [newPath, setNewPath] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (configQuery.data) setDraft(configQuery.data.sandboxReadablePaths ?? []);
  }, [configQuery.data]);

  async function save(paths: string[]) {
    setError("");
    try {
      const config = await saveChatServerConfig({ sandboxReadablePaths: paths });
      queryClient.setQueryData(["chat-server-chat-config"], config);
      setDraft(config.sandboxReadablePaths ?? paths);
      setNotice("已保存。新的 Bash 任务会使用这组读取目录。");
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  async function addPath(value: string) {
    const normalized = value.trim().replace(/\/+$/, "") || "/";
    if (!normalized?.startsWith("/")) {
      setError("请输入绝对目录路径。");
      return;
    }
    if (draft.includes(normalized)) return;
    setNewPath("");
    await save([...draft, normalized]);
  }

  return (
    <>
      <SettingsHeading
        eyebrow="Security"
        title="沙箱"
        description="配置受限 Bash 可以读取的额外目录。这里的目录只读，不能通过沙箱写入。"
      />
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-primary" />
            <div>
              <h2 className="font-medium text-sm">读取目录白名单</h2>
              <p className="mt-1 text-muted-foreground text-xs leading-5">
                workspace
                仍按原规则可读写；这里添加的目录只会授予读取和遍历权限，不会加入写入范围。路径必须是当前
                Chat Server 所在机器上的绝对路径。
              </p>
            </div>
          </div>
        </div>
        {configQuery.isPending ? (
          <div className="space-y-3 p-5" aria-busy="true" role="status">
            <div className="h-10 animate-pulse rounded-md bg-accent" />
            <div className="h-10 animate-pulse rounded-md bg-accent" />
          </div>
        ) : configQuery.isError ? (
          <div className="px-5 py-12 text-center text-sm">读取沙箱设置失败，请刷新页面后重试。</div>
        ) : (
          <>
            <div className="flex flex-col gap-2 border-border border-b p-5 sm:flex-row">
              <Input
                aria-label="绝对目录路径"
                className="h-9 bg-background font-mono text-xs"
                onChange={(event) => setNewPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void addPath(newPath);
                }}
                placeholder="例如 /Users/me/.config/tool"
                value={newPath}
              />
              <Button
                className="shrink-0"
                onClick={() => void addPath(newPath)}
                size="sm"
                type="button"
              >
                <Plus className="size-3.5" /> 添加目录
              </Button>
              <Button
                aria-label="选择目录"
                onClick={async () => {
                  const selected = await pickDirectory();
                  if (selected) await addPath(selected);
                }}
                size="icon"
                type="button"
                variant="outline"
              >
                <ShieldCheck className="size-4" />
              </Button>
            </div>
            {draft.length === 0 ? (
              <div className="px-5 py-12 text-center">
                <ShieldCheck className="mx-auto size-8 text-muted-foreground" />
                <p className="mt-3 font-medium text-sm">还没有额外读取目录</p>
                <p className="mt-1 text-muted-foreground text-xs">
                  默认只允许 workspace 和系统运行所需目录。
                </p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {draft.map((directory) => (
                  <div className="flex items-center gap-3 px-5 py-3" key={directory}>
                    <code className="min-w-0 flex-1 truncate text-xs">{directory}</code>
                    <Button
                      aria-label={`移除 ${directory}`}
                      onClick={() => void save(draft.filter((item) => item !== directory))}
                      size="icon"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 className="size-3.5 text-muted-foreground" />
                    </Button>
                  </div>
                ))}
              </div>
            )}
            {(notice || error) && (
              <div
                className={`border-border border-t px-5 py-3 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
              >
                {error || notice}
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}

const developmentToolLabels: Record<string, string> = {
  node: "Node.js",
  python3: "Python 3",
  python: "Python",
  go: "Go",
  rustc: "Rust",
  java: "Java",
  javac: "Java compiler",
  mvn: "Maven",
  gradle: "Gradle",
  kotlin: "Kotlin",
  kotlinc: "Kotlin compiler",
  dotnet: ".NET",
  cmake: "CMake",
  ninja: "Ninja",
  clang: "Clang",
  gcc: "GCC",
  git: "Git",
  gh: "GitHub CLI",
  docker: "Docker",
  kubectl: "Kubernetes CLI",
  terraform: "Terraform",
  tofu: "OpenTofu",
  ruby: "Ruby",
  php: "PHP",
  composer: "Composer",
  swift: "Swift",
  xcodebuild: "Xcode",
  pod: "CocoaPods",
  flutter: "Flutter",
  dart: "Dart",
  adb: "Android Debug Bridge",
};

const developmentToolGroups = [
  {
    label: "JavaScript",
    names: ["node", "npm", "npx", "pnpm", "yarn", "corepack", "bun", "deno"],
  },
  { label: "Python", names: ["python3", "python", "pip3", "pip", "uv", "poetry"] },
  { label: "Go 与 Rust", names: ["go", "rustc", "cargo", "rustup"] },
  {
    label: "JVM 与 .NET",
    names: ["java", "javac", "mvn", "gradle", "kotlin", "kotlinc", "dotnet"],
  },
  {
    label: "编译与构建",
    names: ["make", "cmake", "ninja", "clang", "clang++", "gcc", "g++"],
  },
  {
    label: "版本控制与基础设施",
    names: ["git", "gh", "docker", "kubectl", "helm", "terraform", "tofu"],
  },
  { label: "Ruby 与 PHP", names: ["ruby", "gem", "php", "composer"] },
  {
    label: "Apple 与移动端",
    names: ["swift", "xcodebuild", "pod", "flutter", "dart", "adb"],
  },
] as const;

function EnvironmentSettingsPage() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["chat-server-chat-config"],
    queryFn: () => loadChatServerConfig(),
  });
  const environmentQuery = useQuery({
    queryKey: ["developer-environment"],
    queryFn: () => loadDeveloperEnvironment(),
  });
  const [draft, setDraft] = useState<string[]>([]);
  const [newPath, setNewPath] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [showUnavailable, setShowUnavailable] = useState(false);

  useEffect(() => {
    if (configQuery.data) setDraft(configQuery.data.developerToolPaths ?? []);
  }, [configQuery.data]);

  async function save(paths: string[], message: string) {
    setError("");
    const config = await saveChatServerConfig({ developerToolPaths: paths });
    queryClient.setQueryData(["chat-server-chat-config"], config);
    setDraft(config.developerToolPaths ?? paths);
    await queryClient.invalidateQueries({ queryKey: ["developer-environment"] });
    const rejected = paths.filter((directory) => !config.developerToolPaths.includes(directory));
    if (rejected.length > 0) {
      throw new Error("目录中未找到受支持且可执行的开发工具。");
    }
    setNotice(message);
  }

  const importMutation = useMutation({
    mutationFn: async () => {
      const imported = await importDeveloperEnvironment();
      const merged = [...new Set([...draft, ...imported.paths])];
      await save(merged, `已导入 ${imported.paths.length} 个开发工具目录。`);
      return imported;
    },
    onSuccess: () => setImportOpen(false),
    onError: (cause) => setError(describeError(cause)),
  });

  async function addPath(value: string) {
    const normalized = value.trim().replace(/\/+$/, "") || "/";
    if (!normalized.startsWith("/")) {
      setError("请输入绝对目录路径。");
      return;
    }
    if (draft.includes(normalized)) return;
    setNewPath("");
    try {
      await save([...draft, normalized], "已添加开发工具目录。");
    } catch (cause) {
      setError(describeError(cause));
    }
  }

  const isPending = configQuery.isPending || environmentQuery.isPending;
  const isError = configQuery.isError || environmentQuery.isError;
  const tools = environmentQuery.data?.tools ?? [];
  const toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  const availableCount = tools.filter((tool) => tool.available).length;
  const visibleGroups = developmentToolGroups.flatMap((group) => {
    const groupTools = group.names.flatMap((name) => {
      const tool = toolsByName.get(name);
      return tool && (showUnavailable || tool.available) ? [tool] : [];
    });
    return groupTools.length > 0 ? [{ ...group, tools: groupTools }] : [];
  });

  return (
    <>
      <SettingsHeading
        eyebrow="Development"
        title="环境"
        description="管理受限终端可以调用的本地开发工具。工具目录只读，workspace 仍是唯一的默认写入范围。"
      />

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex flex-wrap items-start justify-between gap-4 border-border border-b px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <SquareTerminal className="mt-0.5 size-5 shrink-0 text-primary" />
            <div className="min-w-0">
              <h2 className="font-medium text-sm">开发工具</h2>
              <p className="mt-1 truncate text-muted-foreground text-xs">
                Shell：{environmentQuery.data?.shell ?? "正在检测"}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              aria-label="重新检测开发工具"
              disabled={environmentQuery.isFetching}
              onClick={() => void environmentQuery.refetch()}
              size="icon"
              title="重新检测"
              type="button"
              variant="outline"
            >
              <RefreshCw
                className={`size-4 ${environmentQuery.isFetching ? "animate-spin" : ""}`}
              />
            </Button>
            <Button onClick={() => setImportOpen(true)} size="sm" type="button">
              <Download className="size-3.5" /> 从终端导入
            </Button>
          </div>
        </div>
        {!isPending && !isError && (
          <div className="flex items-center justify-between gap-4 border-border border-b px-5 py-3">
            <p className="text-muted-foreground text-xs">
              已检测到 {availableCount} / {tools.length} 个常用命令
            </p>
            <label className="flex cursor-pointer items-center gap-2 text-xs" htmlFor="show-tools">
              <span className="text-muted-foreground">显示未找到</span>
              <Switch
                checked={showUnavailable}
                id="show-tools"
                onCheckedChange={setShowUnavailable}
              />
            </label>
          </div>
        )}
        {isPending ? (
          <div className="grid gap-px bg-border sm:grid-cols-2" aria-busy="true" role="status">
            {["node", "npm", "pnpm", "python3", "go", "cargo", "git", "docker"].map((name) => (
              <div className="h-16 animate-pulse bg-card p-4" key={name}>
                <div className="h-4 w-24 rounded bg-accent" />
                <div className="mt-2 h-3 w-40 rounded bg-accent" />
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="px-5 py-12 text-center text-sm">读取开发工具环境失败，请重新检测。</div>
        ) : (
          <div>
            {visibleGroups.map((group) => (
              <div className="border-border border-b last:border-b-0" key={group.label}>
                <div className="bg-muted/35 px-5 py-2 font-medium text-[11px] text-muted-foreground uppercase">
                  {group.label}
                </div>
                <div className="grid gap-px bg-border sm:grid-cols-2">
                  {group.tools.map((tool) => (
                    <div
                      className="flex min-w-0 items-start gap-3 bg-card px-5 py-4"
                      key={tool.name}
                    >
                      {tool.available ? (
                        <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
                            {developmentToolLabels[tool.name] ?? tool.name}
                          </span>
                          <Badge variant="secondary">{tool.available ? "可用" : "未找到"}</Badge>
                        </div>
                        <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                          {tool.executable ?? "未配置可执行目录"}
                        </p>
                      </div>
                    </div>
                  ))}
                  {group.tools.length % 2 === 1 ? (
                    <div aria-hidden="true" className="hidden bg-card sm:block" />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-5 overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-border border-b px-5 py-4">
          <h2 className="font-medium text-sm">可执行目录</h2>
          <p className="mt-1 text-muted-foreground text-xs leading-5">
            目录会加入受限终端 PATH，并仅授予读取和执行所需权限。
          </p>
        </div>
        <div className="flex flex-col gap-2 border-border border-b p-5 sm:flex-row">
          <Input
            aria-label="开发工具绝对目录"
            className="h-9 bg-background font-mono text-xs"
            onChange={(event) => setNewPath(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void addPath(newPath);
            }}
            placeholder="例如 /Users/me/.local/bin"
            value={newPath}
          />
          <Button onClick={() => void addPath(newPath)} size="sm" type="button" variant="outline">
            <Plus className="size-3.5" /> 添加目录
          </Button>
          <Button
            aria-label="选择开发工具目录"
            onClick={async () => {
              const selected = await pickDirectory();
              if (selected) await addPath(selected);
            }}
            size="icon"
            title="选择目录"
            type="button"
            variant="outline"
          >
            <FolderOpen className="size-4" />
          </Button>
        </div>
        {draft.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <SquareTerminal className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-medium text-sm">尚未配置开发工具目录</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {draft.map((directory) => {
              const directoryTools = tools.filter((tool) => tool.directory === directory);
              return (
                <div className="flex min-w-0 items-center gap-3 px-5 py-3" key={directory}>
                  <code className="min-w-0 flex-1 truncate text-xs">{directory}</code>
                  <div className="hidden items-center gap-1 sm:flex">
                    {directoryTools.map((tool) => (
                      <Badge key={tool.name} variant="outline">
                        {tool.name}
                      </Badge>
                    ))}
                  </div>
                  <Button
                    aria-label={`移除 ${directory}`}
                    onClick={async () => {
                      try {
                        await save(
                          draft.filter((item) => item !== directory),
                          "已移除开发工具目录。",
                        );
                      } catch (cause) {
                        setError(describeError(cause));
                      }
                    }}
                    size="icon"
                    title="移除目录"
                    type="button"
                    variant="ghost"
                  >
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
        {(notice || error) && (
          <div
            className={`border-border border-t px-5 py-3 text-xs ${error ? "text-destructive" : "text-muted-foreground"}`}
          >
            {error || notice}
          </div>
        )}
      </section>

      <AlertDialog onOpenChange={setImportOpen} open={importOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>从终端导入开发工具？</AlertDialogTitle>
            <AlertDialogDescription>
              ChatDesk 会启动一次当前登录
              Shell，并执行其启动配置。只解析常用开发工具的绝对可执行路径；不会保存其他环境变量、Token
              或 API Key。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={importMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={importMutation.isPending}
              onClick={(event) => {
                event.preventDefault();
                importMutation.mutate();
              }}
            >
              {importMutation.isPending && <LoaderCircle className="size-4 animate-spin" />}
              确认导入
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function McpSettingsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"store" | "installed">("store");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [testing, setTesting] = useState<string | null>(null);
  const [confirmServer, setConfirmServer] = useState<McpServerConfig | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<McpRegistryEntry | null>(null);
  const serversQuery = useQuery({ queryKey: ["mcp-servers"], queryFn: loadMcpServers });
  const registryQuery = useQuery({
    queryKey: ["mcp-registry", search],
    queryFn: () => fetchMcpRegistry(search),
    enabled: tab === "store",
  });
  const servers = serversQuery.data ?? [];

  async function install(entry: McpRegistryEntry) {
    const next: McpServerConfig = { ...entry };
    delete (next as Partial<McpRegistryEntry>).installed;
    const normalized = servers.some((server) => server.id === next.id)
      ? servers.map((server) => (server.id === next.id ? next : server))
      : [...servers, next];
    await saveMcpServers(normalized);
    queryClient.setQueryData(["mcp-servers"], normalized);
    setNotice(`已添加 ${entry.name}，首次启用时才会连接。`);
    setTab("installed");
  }

  async function remove(server: McpServerConfig) {
    const next = servers.filter((item) => item.id !== server.id);
    await saveMcpServers(next);
    queryClient.setQueryData(["mcp-servers"], next);
  }

  async function toggleDefault(server: McpServerConfig, enabled: boolean) {
    const next = servers.map((item) =>
      item.id === server.id ? { ...item, enabledByDefault: enabled } : item,
    );
    await saveMcpServers(next);
    queryClient.setQueryData(["mcp-servers"], next);
  }

  async function test(server: McpServerConfig) {
    setTesting(server.id);
    setNotice("");
    try {
      const tools = await testMcpConnection(server);
      const next = servers.map((item) =>
        item.id === server.id
          ? {
              ...item,
              status: "ready" as const,
              lastError: undefined,
              lastCheckedAt: new Date().toISOString(),
            }
          : item,
      );
      await saveMcpServers(next);
      queryClient.setQueryData(["mcp-servers"], next);
      setNotice(`${server.name} 连接成功，发现 ${tools.length} 个工具。`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const next = servers.map((item) =>
        item.id === server.id
          ? {
              ...item,
              status: "error" as const,
              lastError: message,
              lastCheckedAt: new Date().toISOString(),
            }
          : item,
      );
      await saveMcpServers(next);
      queryClient.setQueryData(["mcp-servers"], next);
      setNotice(`${server.name} 连接失败：${message}`);
    } finally {
      setTesting(null);
    }
  }

  return (
    <>
      <SettingsHeading
        eyebrow="Chat"
        title="MCP"
        description="从官方 Registry 添加 MCP 服务，并在 Chat 中选择要启用的服务器。"
      />
      <div className="mb-4 flex gap-2 border-border border-b">
        <Button
          onClick={() => setTab("store")}
          size="sm"
          type="button"
          variant={tab === "store" ? "default" : "ghost"}
        >
          MCP 商店
        </Button>
        <Button
          onClick={() => setTab("installed")}
          size="sm"
          type="button"
          variant={tab === "installed" ? "default" : "ghost"}
        >
          已安装 ({servers.length})
        </Button>
      </div>
      {notice ? <p className="mb-4 text-muted-foreground text-xs">{notice}</p> : null}
      {tab === "store" ? (
        <section className="rounded-lg border border-border bg-card">
          <div className="flex gap-2 border-border border-b p-4">
            <Input
              aria-label="搜索 MCP 服务器"
              className="h-9"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索 MCP 服务器"
              value={search}
            />
            <Button
              onClick={() => void registryQuery.refetch()}
              size="sm"
              type="button"
              variant="outline"
            >
              刷新
            </Button>
          </div>
          {registryQuery.isPending ? (
            <div className="space-y-3 p-5">
              <div className="h-16 animate-pulse rounded-md bg-accent" />
              <div className="h-16 animate-pulse rounded-md bg-accent" />
            </div>
          ) : registryQuery.isError ? (
            <p className="p-8 text-center text-destructive text-sm">
              读取 MCP Registry 失败，请稍后重试。
            </p>
          ) : registryQuery.data?.length ? (
            <div className="divide-y divide-border">
              {registryQuery.data.map((entry) => (
                <div className="flex items-center gap-3 p-4" key={entry.id}>
                  <PlugZap className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{entry.name}</p>
                    <p className="mt-1 truncate text-muted-foreground text-xs">
                      {entry.description || entry.packageName || entry.url}
                    </p>
                    <p className="mt-1 text-muted-foreground text-xs">
                      流行度 {entry.popularity > 0 ? entry.popularity.toLocaleString() : "暂无数据"}
                    </p>
                  </div>
                  <Button
                    onClick={() => setSelectedEntry(entry)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    详情
                  </Button>
                  <Button
                    disabled={entry.installed}
                    onClick={() => void install(entry)}
                    size="sm"
                    type="button"
                  >
                    {entry.installed ? "已安装" : entry.transport === "npx" ? "安装" : "添加"}
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-8 text-center text-muted-foreground text-sm">没有匹配的 MCP 服务器。</p>
          )}
        </section>
      ) : (
        <section className="rounded-lg border border-border bg-card">
          {serversQuery.isPending ? (
            <div className="space-y-3 p-5">
              <div className="h-16 animate-pulse rounded-md bg-accent" />
              <div className="h-16 animate-pulse rounded-md bg-accent" />
            </div>
          ) : servers.length ? (
            <div className="divide-y divide-border">
              {servers.map((server) => (
                <div className="flex flex-wrap items-center gap-3 p-4" key={server.id}>
                  <PlugZap className="size-5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{server.name}</p>
                    <p className="mt-1 truncate text-muted-foreground text-xs">
                      {server.transport === "npx"
                        ? `${server.command ?? "npx"} ${(server.args ?? []).join(" ")}`
                        : server.url}
                    </p>
                    {server.lastError ? (
                      <p className="mt-1 text-destructive text-xs">{server.lastError}</p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground text-xs">
                    <Switch
                      checked={server.enabledByDefault}
                      onCheckedChange={(checked) => void toggleDefault(server, checked === true)}
                      size="sm"
                    />
                    默认启用
                  </div>
                  <Button
                    disabled={testing === server.id}
                    onClick={() =>
                      server.transport === "npx" ? setConfirmServer(server) : void test(server)
                    }
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    {testing === server.id ? "测试中..." : "测试"}
                  </Button>
                  <Button
                    className="text-destructive"
                    onClick={() => void remove(server)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    删除
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="p-8 text-center text-muted-foreground text-sm">还没有安装 MCP 服务器。</p>
          )}
        </section>
      )}
      <Dialog
        open={selectedEntry !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedEntry(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedEntry?.name}</DialogTitle>
            <DialogDescription>{selectedEntry?.description || "暂无描述"}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-muted-foreground text-sm">
            <p>
              连接方式：{selectedEntry?.transport === "npx" ? "npx / stdio" : "Streamable HTTP"}
            </p>
            <p>
              流行度：
              {selectedEntry?.popularity ? selectedEntry.popularity.toLocaleString() : "暂无数据"}
            </p>
            <p className="break-all">{selectedEntry?.packageName || selectedEntry?.url}</p>
          </div>
          <Button
            disabled={selectedEntry?.installed}
            onClick={() => {
              if (selectedEntry) void install(selectedEntry);
              setSelectedEntry(null);
            }}
            type="button"
          >
            {selectedEntry?.installed ? "已安装" : "安装并加入已安装"}
          </Button>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={confirmServer !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmServer(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>启动本地 MCP？</AlertDialogTitle>
            <AlertDialogDescription>
              将执行{" "}
              <code>
                {confirmServer?.command ?? "npx"} {(confirmServer?.args ?? []).join(" ")}
              </code>
              。该进程可访问本机环境，请确认来源可信后继续。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (confirmServer) void test(confirmServer);
                setConfirmServer(null);
              }}
            >
              启动并测试
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SkillsSettingsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [viewingSkill, setViewingSkill] = useState<SkillDefinition | null>(null);
  const skillsQuery = useQuery({ queryKey: ["skills-available"], queryFn: loadAvailableSkills });
  const disabledQuery = useQuery({
    queryKey: ["skills-disabled"],
    queryFn: loadDisabledSkillIds,
  });
  const skills = skillsQuery.data ?? [];
  const disabledIds = disabledQuery.data ?? [];
  const disabledSet = new Set(disabledIds);
  const visibleSkills = skills.filter((skill) => {
    const query = search.trim().toLowerCase();
    return (
      !query ||
      skill.name.toLowerCase().includes(query) ||
      skill.description.toLowerCase().includes(query) ||
      skill.path.toLowerCase().includes(query)
    );
  });

  async function toggle(skill: SkillDefinition, enabled: boolean) {
    const next = enabled ? disabledIds.filter((id) => id !== skill.id) : [...disabledIds, skill.id];
    await saveDisabledSkillIds(next);
    queryClient.setQueryData(["skills-disabled"], [...new Set(next)]);
  }

  return (
    <>
      <SettingsHeading
        eyebrow="Chat"
        title="Skills"
        description="选择哪些本机 skill 可在 Chat 中使用。ChatDesk 会按需使用内置产品说明，无需在此启用。"
      />
      <p className="mb-4 max-w-2xl text-muted-foreground text-sm leading-6">
        当前列表来自本机{" "}
        <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[12px]">
          ~/.agents/skills
        </code>
        。默认全部启用，取消后不会出现在 Chat 中。Chat
        里还可以按会话临时关闭，不会改这里的全局设置。
      </p>
      <section className="rounded-lg border border-border bg-card">
        <div className="flex gap-2 border-border border-b p-4">
          <Input
            aria-label="搜索 skill"
            className="h-9"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索 skill"
            value={search}
          />
          <Button
            onClick={() => void skillsQuery.refetch()}
            size="sm"
            type="button"
            variant="outline"
          >
            刷新
          </Button>
        </div>
        {skillsQuery.isPending || disabledQuery.isPending ? (
          <div aria-busy="true" className="space-y-3 p-5" role="status">
            <div className="h-16 animate-pulse rounded-md bg-accent" />
            <div className="h-16 animate-pulse rounded-md bg-accent" />
          </div>
        ) : skillsQuery.isError ? (
          <p className="p-8 text-center text-destructive text-sm">
            扫描本机 skill 失败，请稍后重试。
          </p>
        ) : visibleSkills.length ? (
          <div className="divide-y divide-border">
            {visibleSkills.map((skill) => (
              <div className="flex items-center gap-3 p-4" key={skill.id}>
                <Sparkles className="size-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm">{skill.name}</p>
                  <p className="mt-1 truncate text-muted-foreground text-xs">
                    {skill.description || "暂无描述"}
                  </p>
                  <p className="mt-1 truncate text-muted-foreground text-[11px]">{skill.path}</p>
                </div>
                <Button
                  aria-label={`查看 ${skill.name} 的 SKILL.md`}
                  className="shrink-0"
                  onClick={() => setViewingSkill(skill)}
                  size="icon"
                  title="查看 SKILL.md"
                  type="button"
                  variant="ghost"
                >
                  <FileText className="size-4" />
                </Button>
                <Switch
                  aria-label={`${disabledSet.has(skill.id) ? "启用" : "停用"} ${skill.name}`}
                  checked={!disabledSet.has(skill.id)}
                  onCheckedChange={(checked) => void toggle(skill, checked === true)}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="p-8 text-center text-muted-foreground text-sm">
            {search.trim()
              ? "没有匹配的 skill。"
              : "未在 ~/.agents/skills 发现 skill。把含 SKILL.md 的目录放到该路径后刷新即可。"}
          </p>
        )}
      </section>
      <Dialog
        open={viewingSkill !== null}
        onOpenChange={(open) => {
          if (!open) setViewingSkill(null);
        }}
      >
        <DialogContent className="flex max-h-[85vh] w-[960px] max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0 sm:max-w-[960px]">
          {viewingSkill ? (
            <>
              <DialogHeader className="border-border border-b px-5 py-4 text-left">
                <DialogTitle className="text-base">{viewingSkill.name}</DialogTitle>
                <DialogDescription className="truncate text-xs">
                  {viewingSkill.source} · {viewingSkill.path}
                </DialogDescription>
              </DialogHeader>
              <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
                <div className="[&>div]:max-w-none">
                  <ChatMarkdown isAnimating={false}>
                    {stripSkillFrontmatter(viewingSkill.content)}
                  </ChatMarkdown>
                </div>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function ChatServerSettingsPage() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["chat-server-config"],
    queryFn: async () => {
      const port = await loadChatServerPort();
      try {
        return { port, health: await checkChatServer(port) };
      } catch {
        return { port, health: null };
      }
    },
  });
  const [port, setPort] = useState(14317);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (configQuery.data) setPort(configQuery.data.port);
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () => updateChatServerPort(port),
    onSuccess: (result) => {
      setNotice(result.restartRequired ? "端口已保存，重启 Chat Server 后生效。" : "端口已保存。 ");
      void queryClient.invalidateQueries({ queryKey: ["chat-server-config"] });
    },
  });
  const restartMutation = useMutation({
    mutationFn: restartChatServer,
    onSuccess: () => {
      setNotice("Chat Server 已重启。");
      void queryClient.invalidateQueries({ queryKey: ["chat-server-config"] });
    },
  });
  return (
    <>
      <SettingsHeading
        eyebrow="连接"
        title="Chat Server"
        description="配置本地 Hono Chat Server 的监听端口，或在桌面应用中手动重启服务。"
      />
      <div className="max-w-xl space-y-5 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-medium text-sm">监听端口</p>
            <p className="mt-1 text-muted-foreground text-xs">默认端口为 14317。</p>
          </div>
          <Input
            className="w-32 font-mono"
            max={65535}
            min={1024}
            onChange={(event) => setPort(Number(event.target.value))}
            type="number"
            value={port}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p
            className={
              configQuery.data?.health
                ? "text-emerald-600 text-xs"
                : "text-muted-foreground text-xs"
            }
          >
            {configQuery.data?.health ? "Server 已连接" : "Server 当前未连接"}
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={saveMutation.isPending || port < 1024 || port > 65535}
              onClick={() => saveMutation.mutate()}
              type="button"
            >
              保存端口
            </Button>
            <Button
              disabled={!canRestartChatServer() || restartMutation.isPending}
              onClick={() => restartMutation.mutate()}
              type="button"
              variant="outline"
            >
              <RefreshCw className={restartMutation.isPending ? "size-4 animate-spin" : "size-4"} />
              重启服务
            </Button>
          </div>
        </div>
        {notice ? <p className="text-muted-foreground text-xs">{notice}</p> : null}
        {saveMutation.isError ? (
          <p className="text-destructive text-xs">保存失败：{describeError(saveMutation.error)}</p>
        ) : null}
        {restartMutation.isError ? (
          <p className="text-destructive text-xs">
            重启失败：{describeError(restartMutation.error)}
          </p>
        ) : null}
      </div>
    </>
  );
}

type KeyConfig = {
  title: string;
  keyName: string;
  description: string;
  load: () => Promise<string>;
  save: (key: string) => Promise<void>;
  clear: () => Promise<void>;
};

const keyConfigs: KeyConfig[] = [
  {
    title: "KIE Image",
    keyName: "KIE_API_KEY",
    description: "用于图片生成页面调用 GPT Image 2。",
    load: loadKieApiKey,
    save: saveKieApiKey,
    clear: clearKieApiKey,
  },
];

function ApiKeysSettingsPage() {
  return (
    <>
      <SettingsHeading
        eyebrow="Connections"
        title="API Keys"
        description="密钥只保存在当前设备，不会回显。输入新的值即可覆盖已有配置。"
      />
      <div className="space-y-4">
        {keyConfigs.map((config) => (
          <ApiKeyCard config={config} key={config.keyName} />
        ))}
      </div>
    </>
  );
}

function ApiKeyCard({ config }: { config: KeyConfig }) {
  const [draftKey, setDraftKey] = useState("");
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [notice, setNotice] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void config.load().then((key) => {
      if (active) setHasSavedKey(Boolean(key.trim()));
    });
    return () => {
      active = false;
    };
  }, [config]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const key = draftKey.trim();
    if (!key) {
      setNotice(`请输入 ${config.keyName}。`);
      return;
    }
    setIsSaving(true);
    setNotice("");
    try {
      await config.save(key);
      setHasSavedKey(true);
      setDraftKey("");
      setNotice("已保存，密钥不会在页面中回显。");
    } catch {
      setNotice("保存失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleClear() {
    setIsSaving(true);
    setNotice("");
    try {
      await config.clear();
      setHasSavedKey(false);
      setDraftKey("");
      setNotice("已清除保存的密钥。");
    } catch {
      setNotice("清除失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card px-5 py-4">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
          <KeyRound className="size-4" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-medium text-sm">{config.title}</h2>
          <p className="mt-1 text-muted-foreground text-xs leading-5">{config.description}</p>
          <form className="mt-4" onSubmit={handleSave}>
            <label className="font-mono text-[11px] text-muted-foreground" htmlFor={config.keyName}>
              {config.keyName}
            </label>
            <div className="mt-1.5 flex flex-wrap gap-2">
              <Input
                autoComplete="off"
                className="h-9 min-w-0 flex-1 font-mono text-xs sm:max-w-md"
                id={config.keyName}
                onChange={(event) => setDraftKey(event.target.value)}
                placeholder={hasSavedKey ? "已保存 ········（输入新值可覆盖）" : "输入 API Key"}
                type="password"
                value={draftKey}
              />
              <Button disabled={isSaving} size="sm" type="submit">
                <KeyRound className="size-3.5" />
                {isSaving ? "保存中…" : hasSavedKey ? "覆盖保存" : "保存"}
              </Button>
              {hasSavedKey ? (
                <Button
                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={isSaving}
                  onClick={() => void handleClear()}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" />
                  清除
                </Button>
              ) : null}
            </div>
            {notice ? <p className="mt-2 text-muted-foreground text-xs">{notice}</p> : null}
          </form>
        </div>
      </div>
    </section>
  );
}

const emptyModel: Omit<ModelConfig, "id"> = {
  name: "",
  provider: "自定义 / Custom",
  baseUrl: "",
  apiKey: "",
  supportsTools: true,
  supportsImages: false,
  supportsReasoning: false,
  customProtocol: false,
  responsive: false,
  inputContext: undefined,
  outputContext: undefined,
  inputPricePerMillion: undefined,
  outputPricePerMillion: undefined,
  cacheReadPricePerMillion: undefined,
  cacheWritePricePerMillion: undefined,
  isDefault: false,
};

const DEEPSEEK_CHAT_BASE_URL = "https://api.deepseek.com/chat/completions";
const DEEPSEEK_RESPONSES_BASE_URL = "https://api.deepseek.com";
const KIMI_CHAT_BASE_URL = "https://api.moonshot.cn/v1";
const MINIMAX_CHAT_BASE_URL = "https://api.minimaxi.com/v1";
const OPENROUTER_CHAT_BASE_URL = "https://openrouter.ai/api/v1";
const OPENROUTER_MODEL_PAGE_SIZE = 20;

function deepseekBaseUrl(responsive: boolean) {
  return responsive ? DEEPSEEK_RESPONSES_BASE_URL : DEEPSEEK_CHAT_BASE_URL;
}

const providerPresets = {
  custom: {
    label: "自定义 / Custom",
    baseUrl: "",
    models: [],
  },
  deepseek: {
    label: "深度求索 / DeepSeek",
    baseUrl: DEEPSEEK_CHAT_BASE_URL,
    models: [
      {
        name: "deepseek-v4-flash",
        supportsTools: true,
        supportsImages: false,
        supportsReasoning: false,
        inputContext: 1_000_000,
        outputContext: 8_000,
      },
      {
        name: "deepseek-v4-flash-vision-exp",
        supportsTools: true,
        supportsImages: true,
        supportsReasoning: true,
        inputContext: 1_000_000,
        outputContext: 384_000,
      },
      {
        name: "deepseek-v4-pro",
        supportsTools: true,
        supportsImages: false,
        supportsReasoning: true,
        inputContext: 1_000_000,
        outputContext: 64_000,
      },
    ],
  },
  kimi: {
    label: "Kimi / Moonshot",
    baseUrl: KIMI_CHAT_BASE_URL,
    models: [
      {
        name: "kimi-k3",
        supportsTools: true,
        supportsImages: true,
        supportsReasoning: true,
        inputContext: 1_000_000,
      },
      {
        name: "kimi-k2.7-code",
        supportsTools: true,
        supportsImages: false,
        supportsReasoning: true,
        inputContext: 256_000,
      },
      {
        name: "kimi-k2.7-code-highspeed",
        supportsTools: true,
        supportsImages: false,
        supportsReasoning: true,
        inputContext: 256_000,
      },
      {
        name: "kimi-k2.6",
        supportsTools: true,
        supportsImages: true,
        supportsReasoning: true,
        inputContext: 256_000,
      },
      {
        name: "kimi-k2.5",
        supportsTools: true,
        supportsImages: true,
        supportsReasoning: true,
        inputContext: 256_000,
      },
    ],
  },
  minimax: {
    label: "MiniMax",
    baseUrl: MINIMAX_CHAT_BASE_URL,
    models: [
      {
        name: "MiniMax-M3",
        supportsTools: true,
        supportsImages: true,
        supportsReasoning: true,
        inputContext: 1_000_000,
      },
      {
        name: "MiniMax-M2.7",
        supportsTools: true,
        supportsImages: false,
        supportsReasoning: true,
        inputContext: 204_800,
      },
      {
        name: "MiniMax-M2.5",
        supportsTools: true,
        supportsImages: false,
        supportsReasoning: true,
        inputContext: 204_800,
      },
    ],
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: OPENROUTER_CHAT_BASE_URL,
    models: [],
  },
} as const;

type ProviderKey = keyof typeof providerPresets;
type CatalogProviderKey = Exclude<ProviderKey, "custom">;
const PROVIDER_KEYS: ProviderKey[] = ["deepseek", "kimi", "minimax", "openrouter", "custom"];

function isCatalogProvider(provider: ProviderKey): provider is CatalogProviderKey {
  return provider !== "custom";
}

function getProviderIcon(provider: ProviderKey) {
  switch (provider) {
    case "deepseek":
      return Brain;
    case "kimi":
      return Sparkles;
    case "minimax":
      return Server;
    case "openrouter":
      return Waypoints;
    case "custom":
      return Wrench;
  }
}

function providerDocsUrl(provider: CatalogProviderKey) {
  switch (provider) {
    case "deepseek":
      return "https://platform.deepseek.com/api-docs";
    case "kimi":
      return "https://platform.kimi.com/docs";
    case "minimax":
      return "https://platform.minimaxi.com/docs";
    case "openrouter":
      return "https://openrouter.ai/docs/quickstart";
  }
}

type ProviderPresetModel = {
  name: string;
  supportsTools: boolean;
  supportsImages: boolean;
  supportsReasoning: boolean;
  inputContext?: number;
  outputContext?: number;
  inputPricePerMillion?: number;
  outputPricePerMillion?: number;
  cacheReadPricePerMillion?: number;
  cacheWritePricePerMillion?: number;
};

type ListedProviderModel = ChatServerProviderModel;

function providerKeyForLabel(label: string): ProviderKey {
  if (label === providerPresets.deepseek.label) return "deepseek";
  if (label === providerPresets.kimi.label) return "kimi";
  if (label === providerPresets.minimax.label) return "minimax";
  if (label === providerPresets.openrouter.label) return "openrouter";
  return "custom";
}

function providerModelsCacheKey(baseUrl: string, apiKey: string) {
  let hash = 2166136261;
  for (const character of apiKey) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return ["provider-models", baseUrl, (hash >>> 0).toString(16)] as const;
}

function ModelsSettingsPage() {
  const queryClient = useQueryClient();
  const modelsQuery = useQuery({ queryKey: ["models"], queryFn: loadModels });
  const chatConfigQuery = useQuery({
    queryKey: ["chat-server-chat-config"],
    queryFn: () => loadChatServerConfig(),
  });
  const models = modelsQuery.data ?? [];
  const sortedModels = sortModelsByName(models);
  const [notice, setNotice] = useState("");
  const [reviewerNotice, setReviewerNotice] = useState("");
  const [editing, setEditing] = useState<ModelConfig | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modelToDelete, setModelToDelete] = useState<ModelConfig | null>(null);
  const reviewerMutation = useMutation({
    mutationFn: (modelId: string) =>
      saveChatServerConfig({
        approvalReviewerModelId: modelId === "__none__" ? undefined : modelId,
      }),
    onSuccess: (config, modelId) => {
      queryClient.setQueryData(["chat-server-chat-config"], config);
      if (modelId === "__none__") {
        setReviewerNotice("已关闭自动 Reviewer。沙箱拦截的请求会暂停，并等待你的人工确认。");
        return;
      }
      const model = models.find((item) => item.id === modelId);
      setReviewerNotice(
        `已保存：${model ? `「${formatModelLabel(model)}」` : "选定模型"} 现在负责判断沙箱拦截后的单次重试。Reviewer 不会执行工具或读取工作区；判断失败时会返回沙箱拦截错误。`,
      );
    },
  });
  const reviewerModelId = chatConfigQuery.data?.approvalReviewerModelId ?? "__none__";

  function openCreate() {
    setNotice("");
    setEditing({ ...emptyModel, id: crypto.randomUUID() });
    setIsModalOpen(true);
  }

  function openEdit(model: ModelConfig) {
    setNotice("");
    setEditing({ ...model });
    setIsModalOpen(true);
  }

  async function handleSave(model: ModelConfig) {
    const nextModels = models.some((item) => item.id === model.id)
      ? models.map((item) => (item.id === model.id ? model : item))
      : [...models, model];
    const normalized = model.isDefault
      ? nextModels.map((item) => ({ ...item, isDefault: item.id === model.id }))
      : nextModels;
    await saveModels(normalized);
    queryClient.setQueryData(["models"], normalized);
    void queryClient.invalidateQueries({ queryKey: ["chat-server-chat-config"] });
    await queryClient.invalidateQueries({ queryKey: ["ai-usage-statistics"] });
    setIsModalOpen(false);
    setEditing(null);
  }

  async function confirmDelete() {
    const model = modelToDelete;
    if (!model) return;
    const remaining = models.filter((item) => item.id !== model.id);
    if (model.isDefault && remaining.length > 0)
      remaining[0] = { ...remaining[0], isDefault: true };
    try {
      await saveModels(remaining);
      queryClient.setQueryData(["models"], remaining);
      void queryClient.invalidateQueries({ queryKey: ["chat-server-chat-config"] });
      setModelToDelete(null);
    } catch {
      setNotice("删除失败，请重试。");
    }
  }

  async function handleSetDefault(model: ModelConfig) {
    const nextModels = models.map((item) => ({ ...item, isDefault: item.id === model.id }));
    try {
      await saveModels(nextModels);
      queryClient.setQueryData(["models"], nextModels);
    } catch {
      setNotice("设置默认模型失败，请重试。");
    }
  }

  return (
    <>
      <SettingsHeading
        eyebrow="Models"
        title="模型"
        description="管理可用的 OpenAI 兼容模型配置，以及用于自动审批边界请求的 Reviewer。"
      />
      <section className="rounded-lg border border-border bg-card">
        <div className="flex items-center justify-between gap-4 border-border border-b px-5 py-4">
          <div>
            <h2 className="font-medium text-sm">自定义模型</h2>
            <p className="mt-1 text-muted-foreground text-xs">
              支持 OpenAI Chat Completions 与 Responses API。
            </p>
          </div>
          <Button onClick={openCreate} size="sm" type="button">
            <Plus className="size-3.5" /> 添加模型
          </Button>
        </div>
        {notice || modelsQuery.isError ? (
          <p className="px-5 pt-4 text-destructive text-xs">
            {notice || "读取模型配置失败，请重试。"}
          </p>
        ) : null}
        {modelsQuery.isLoading ? (
          <div className="space-y-3 p-5">
            <div className="h-16 animate-pulse rounded-md bg-accent" />
            <div className="h-16 animate-pulse rounded-md bg-accent" />
          </div>
        ) : models.length === 0 ? (
          <div className="px-5 py-14 text-center">
            <Package className="mx-auto size-8 text-muted-foreground" />
            <p className="mt-3 font-medium text-sm">还没有模型配置</p>
            <p className="mt-1 text-muted-foreground text-xs">添加一个 OpenAI 兼容模型开始使用。</p>
          </div>
        ) : (
          <div className="space-y-3 p-5">
            {sortedModels.map((model) => (
              <div
                className="flex items-center gap-3 rounded-md border border-border bg-background px-4 py-3"
                key={model.id}
              >
                <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
                  <Package className="size-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate font-medium text-sm">{formatModelLabel(model)}</h3>
                    {model.isDefault ? (
                      <Badge className="px-2 py-0.5 text-[10px]">默认</Badge>
                    ) : null}
                  </div>
                  <div className="mt-1 flex min-w-0 items-center gap-2 text-muted-foreground text-xs">
                    <p className="min-w-0 truncate">
                      {model.provider} · {model.baseUrl}
                    </p>
                    <span aria-hidden="true" className="shrink-0">
                      ·
                    </span>
                    <span className="shrink-0 font-mono">
                      上下文 {formatModelContextSize(model.inputContext)}
                    </span>
                  </div>
                </div>
                {!model.isDefault ? (
                  <Button
                    aria-label={`设为 ${formatModelLabel(model)} 的默认模型`}
                    onClick={() => void handleSetDefault(model)}
                    size="icon"
                    type="button"
                    variant="ghost"
                  >
                    <Check className="size-4" />
                  </Button>
                ) : null}
                <Button
                  aria-label={`编辑 ${formatModelLabel(model)}`}
                  onClick={() => openEdit(model)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Pencil className="size-4" />
                </Button>
                <Button
                  aria-label={`删除 ${formatModelLabel(model)}`}
                  className="text-destructive hover:text-destructive"
                  onClick={() => setModelToDelete(model)}
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section className="mt-5 rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="font-medium text-sm">权限 Reviewer</h2>
            <p className="mt-1 max-w-lg text-muted-foreground text-xs leading-5">
              Approve for me 遇到沙箱拦截
              的请求时，由选定模型判断是否允许一次性执行。未配置、拒绝或调用失败时返回沙箱拦截错误。
            </p>
            <p className="mt-2 max-w-lg text-muted-foreground text-xs leading-5">
              Reviewer 只接收精简的对话上下文、工具名称和参数摘要，不会执行工具或读取工作区内容。
              每次批准只对当前 tool call 生效，不会修改全局沙箱权限。
            </p>
          </div>
          <div className="flex w-full shrink-0 flex-col gap-2 sm:w-80">
            <Select
              disabled={
                chatConfigQuery.isLoading || modelsQuery.isLoading || reviewerMutation.isPending
              }
              value={reviewerModelId}
              onValueChange={(value) => {
                setReviewerNotice("");
                reviewerMutation.mutate(value);
              }}
            >
              <SelectTrigger aria-label="选择权限 Reviewer" className="w-full">
                <SelectValue placeholder="未配置" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">未配置（人工确认）</SelectItem>
                {sortedModels.map((model) => (
                  <SelectItem key={model.id} value={model.id}>
                    {formatModelLabel(model)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {reviewerMutation.isError ? (
              <p className="text-destructive text-xs" role="alert">
                Reviewer 设置保存失败：{describeError(reviewerMutation.error)}
              </p>
            ) : reviewerNotice ? (
              <p className="text-emerald-600 text-xs dark:text-emerald-400" role="status">
                {reviewerNotice}
              </p>
            ) : null}
          </div>
        </div>
      </section>
      {isModalOpen && editing ? (
        <ModelDialog
          initialModel={editing}
          onClose={() => {
            setIsModalOpen(false);
            setEditing(null);
          }}
          onSave={handleSave}
        />
      ) : null}
      <AlertDialog
        open={modelToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setModelToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除模型？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要删除“{modelToDelete ? formatModelLabel(modelToDelete) : "这个模型"}
              ”吗？删除后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function ModelDialog({
  initialModel,
  onClose,
  onSave,
}: {
  initialModel: ModelConfig;
  onClose: () => void;
  onSave: (model: ModelConfig) => Promise<void>;
}) {
  const queryClient = useQueryClient();
  const [model, setModel] = useState(initialModel);
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [providerModels, setProviderModels] = useState<ProviderPresetModel[]>(() => {
    const initialProviderKey = providerKeyForLabel(initialModel.provider);
    const models: ProviderPresetModel[] = isCatalogProvider(initialProviderKey)
      ? providerPresets[initialProviderKey].models.map((item) => ({ ...item }))
      : [];
    if (
      isCatalogProvider(initialProviderKey) &&
      initialModel.name &&
      !models.some((item) => item.name === initialModel.name)
    ) {
      models.push({
        name: initialModel.name,
        supportsTools: initialModel.supportsTools,
        supportsImages: initialModel.supportsImages,
        supportsReasoning: initialModel.supportsReasoning,
        inputContext: initialModel.inputContext,
        outputContext: initialModel.outputContext,
        inputPricePerMillion: initialModel.inputPricePerMillion,
        outputPricePerMillion: initialModel.outputPricePerMillion,
        cacheReadPricePerMillion: initialModel.cacheReadPricePerMillion,
        cacheWritePricePerMillion: initialModel.cacheWritePricePerMillion,
      });
    }
    return models;
  });
  const [providerModelsProvider, setProviderModelsProvider] = useState<ProviderKey | null>(() => {
    const key = providerKeyForLabel(initialModel.provider);
    return isCatalogProvider(key) ? key : null;
  });
  const [modelSearch, setModelSearch] = useState("");
  const [visibleProviderModelCount, setVisibleProviderModelCount] = useState(
    OPENROUTER_MODEL_PAGE_SIZE,
  );
  const [testState, setTestState] = useState<
    { type: "success" | "error"; message: string } | undefined
  >();
  const providerKey = providerKeyForLabel(model.provider);
  const presetModels: ProviderPresetModel[] =
    isCatalogProvider(providerKey) && providerModelsProvider === providerKey
      ? providerModels
      : providerPresets[providerKey].models.map((item) => ({ ...item }));
  const filteredPresetModels =
    providerKey === "openrouter" && modelSearch.trim()
      ? presetModels.filter((item) =>
          item.name.toLocaleLowerCase().includes(modelSearch.trim().toLocaleLowerCase()),
        )
      : presetModels;
  const visiblePresetModels =
    providerKey === "openrouter"
      ? filteredPresetModels.slice(0, visibleProviderModelCount)
      : filteredPresetModels;
  const hasMoreProviderModels = visiblePresetModels.length < filteredPresetModels.length;
  const providerBaseUrl = model.baseUrl.trim();
  const providerApiKey = model.apiKey.trim();
  const providerModelsQueryKey = providerModelsCacheKey(providerBaseUrl, providerApiKey);
  const providerModelsQuery = useQuery({
    queryKey: providerModelsQueryKey,
    queryFn: () => listChatServerModels({ baseUrl: providerBaseUrl, apiKey: providerApiKey }),
    enabled: false,
    staleTime: 5 * 60 * 1000,
  });
  const isLoadingProviderModels = providerModelsQuery.isFetching;
  function update<K extends keyof ModelConfig>(key: K, value: ModelConfig[K]) {
    setError("");
    setTestState(undefined);
    setModel((current) => ({ ...current, [key]: value }));
  }

  function readConnectionFields() {
    const name = model.name.trim();
    const baseUrl = model.baseUrl.trim();
    const apiKey = model.apiKey.trim();
    if (!name || !baseUrl || !apiKey) {
      setError("请填写模型名称、接口地址和 API Key。");
      return null;
    }
    try {
      const url = new URL(baseUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      setError("接口地址必须是合法的 http 或 https URL。");
      return null;
    }
    return { name, baseUrl, apiKey };
  }

  async function refreshProviderModels() {
    setError("");
    setTestState(undefined);
    const baseUrl = providerBaseUrl;
    const apiKey = providerApiKey;
    if (!baseUrl || !apiKey) {
      setError("请填写接口地址和 API Key。");
      return;
    }
    try {
      const listed = await queryClient.ensureQueryData({
        queryKey: providerModelsQueryKey,
        queryFn: () => listChatServerModels({ baseUrl, apiKey }),
        staleTime: 5 * 60 * 1000,
      });
      const modelPrefix =
        providerKey === "deepseek"
          ? /^deepseek-/i
          : providerKey === "minimax"
            ? /^minimax-/i
            : providerKey === "kimi"
              ? /^(kimi-|moonshot-)/i
              : /./;
      const nextModels: ProviderPresetModel[] = (listed as ListedProviderModel[])
        .filter((item) => modelPrefix.test(item.id))
        .map((item: ChatServerProviderModel) => ({
          name: item.id,
          supportsTools: providerKey === "openrouter" ? item.supportsTools === true : true,
          supportsImages:
            providerKey === "minimax"
              ? item.id.toLowerCase() === "minimax-m3"
              : item.supportsImageIn === true,
          supportsReasoning: providerKey === "minimax" ? true : item.supportsReasoning === true,
          inputContext: item.contextLength,
          outputContext: item.outputContext,
          inputPricePerMillion: item.inputPricePerMillion,
          outputPricePerMillion: item.outputPricePerMillion,
          cacheReadPricePerMillion: item.cacheReadPricePerMillion,
          cacheWritePricePerMillion: item.cacheWritePricePerMillion,
        }));
      if (nextModels.length === 0) {
        throw new Error(`接口未返回可用的 ${providerPresets[providerKey].label} 模型`);
      }
      setProviderModels(nextModels);
      setProviderModelsProvider(providerKey);
      setModelSearch("");
      setVisibleProviderModelCount(OPENROUTER_MODEL_PAGE_SIZE);
      const selected = nextModels.find((item) => item.name === model.name) ?? nextModels[0];
      setModel((current) => ({ ...current, ...selected, baseUrl }));
      setTestState({
        type: "success",
        message: `已获取 ${nextModels.length} 个 ${providerPresets[providerKey].label} 模型`,
      });
    } catch (refreshError) {
      setTestState({ type: "error", message: `获取模型失败：${describeError(refreshError)}` });
    }
  }

  async function testConnection() {
    setError("");
    setTestState(undefined);
    const fields = readConnectionFields();
    if (!fields) return;
    setIsTesting(true);
    try {
      const result = await testChatServerModel({ ...fields, responsive: model.responsive });
      setTestState({ type: "success", message: `API 可用，响应耗时 ${result.durationMs} ms` });
    } catch (testError) {
      setTestState({ type: "error", message: `API 不可用：${describeError(testError)}` });
    } finally {
      setIsTesting(false);
    }
  }

  function handleProviderChange(nextProvider: ProviderKey) {
    const preset = providerPresets[nextProvider];
    const firstModel = preset.models[0] as ProviderPresetModel | undefined;
    setError("");
    setTestState(undefined);
    setModelSearch("");
    setVisibleProviderModelCount(OPENROUTER_MODEL_PAGE_SIZE);
    setModel((current) => ({
      ...current,
      provider: preset.label,
      baseUrl:
        nextProvider === "deepseek"
          ? deepseekBaseUrl(current.responsive)
          : nextProvider === "kimi"
            ? KIMI_CHAT_BASE_URL
            : nextProvider === "minimax"
              ? MINIMAX_CHAT_BASE_URL
              : nextProvider === "openrouter"
                ? OPENROUTER_CHAT_BASE_URL
                : "",
      responsive:
        nextProvider === "kimi" || nextProvider === "openrouter" ? false : current.responsive,
      ...(nextProvider !== "custom" && firstModel
        ? {
            name: firstModel.name,
            supportsTools: firstModel.supportsTools,
            supportsImages: firstModel.supportsImages,
            supportsReasoning: firstModel.supportsReasoning,
            customProtocol: false,
            inputContext: firstModel.inputContext,
            outputContext: firstModel.outputContext,
            inputPricePerMillion: firstModel.inputPricePerMillion,
            outputPricePerMillion: firstModel.outputPricePerMillion,
            cacheReadPricePerMillion: firstModel.cacheReadPricePerMillion,
            cacheWritePricePerMillion: firstModel.cacheWritePricePerMillion,
          }
        : nextProvider === "openrouter"
          ? {
              name: "",
              supportsTools: false,
              supportsImages: false,
              supportsReasoning: false,
              customProtocol: false,
              inputContext: undefined,
              outputContext: undefined,
              inputPricePerMillion: undefined,
              outputPricePerMillion: undefined,
              cacheReadPricePerMillion: undefined,
              cacheWritePricePerMillion: undefined,
            }
          : {}),
    }));
  }

  function handlePresetModelChange(name: string) {
    const preset = presetModels.find((item) => item.name === name);
    if (!preset) return;
    setError("");
    setTestState(undefined);
    setModel((current) => ({
      ...current,
      name: preset.name,
      baseUrl:
        providerKey === "deepseek"
          ? deepseekBaseUrl(current.responsive)
          : providerKey === "minimax"
            ? MINIMAX_CHAT_BASE_URL
            : providerKey === "openrouter"
              ? OPENROUTER_CHAT_BASE_URL
              : KIMI_CHAT_BASE_URL,
      supportsTools: preset.supportsTools,
      supportsImages: preset.supportsImages,
      supportsReasoning: preset.supportsReasoning,
      customProtocol: false,
      inputContext: preset.inputContext,
      outputContext: preset.outputContext,
      inputPricePerMillion: preset.inputPricePerMillion,
      outputPricePerMillion: preset.outputPricePerMillion,
      cacheReadPricePerMillion: preset.cacheReadPricePerMillion,
      cacheWritePricePerMillion: preset.cacheWritePricePerMillion,
    }));
  }

  function handleResponsiveChange(responsive: boolean) {
    setError("");
    setTestState(undefined);
    setModel((current) => ({
      ...current,
      responsive: providerKey === "kimi" ? false : responsive,
      ...(providerKey === "deepseek" ? { baseUrl: deepseekBaseUrl(responsive) } : {}),
    }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = readConnectionFields();
    if (!fields) return;
    if (
      (model.inputContext !== undefined &&
        (!Number.isInteger(model.inputContext) || model.inputContext <= 0)) ||
      (model.outputContext !== undefined &&
        (!Number.isInteger(model.outputContext) || model.outputContext <= 0))
    ) {
      setError("输入和输出上限必须是正整数。");
      return;
    }
    setIsSaving(true);
    setError("");
    try {
      await onSave({ ...model, ...fields });
    } catch {
      setError("保存失败，请重试。");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <form
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-border bg-card shadow-xl"
        onSubmit={submit}
      >
        <div className="flex items-center justify-between border-border border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold text-lg">{initialModel.name ? "编辑模型" : "添加模型"}</h2>
            <span className="rounded-full border border-border px-2 py-0.5 text-muted-foreground text-xs">
              仅支持 OpenAI 兼容协议
            </span>
          </div>
          <Button aria-label="关闭" onClick={onClose} size="icon" type="button" variant="ghost">
            <X className="size-4" />
          </Button>
        </div>
        <div className="space-y-5 px-6 py-5">
          <div className="flex items-end gap-3">
            <div className="block min-w-0 flex-1 text-sm">
              <span className="font-medium">提供商</span>
              <Select
                value={providerKey}
                onValueChange={(value) => handleProviderChange(value as ProviderKey)}
              >
                <SelectTrigger className="mt-2 h-10 w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_KEYS.map((key) => {
                    const ProviderIcon = getProviderIcon(key);
                    return (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          <ProviderIcon className="size-4 text-muted-foreground" />
                          <span>{providerPresets[key].label}</span>
                        </span>
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            {isCatalogProvider(providerKey) ? (
              <a
                className="mb-2 inline-flex shrink-0 items-center gap-1 text-sm text-sky-500 hover:text-sky-400"
                href={providerDocsUrl(providerKey)}
                onClick={(event) => {
                  event.preventDefault();
                  window.open(providerDocsUrl(providerKey), "_blank", "noopener,noreferrer");
                }}
                rel="noreferrer"
                target="_blank"
              >
                查看文档 <ExternalLink className="size-3.5" />
              </a>
            ) : null}
          </div>
          {providerKey === "custom" || isCatalogProvider(providerKey) ? (
            <div className="block text-sm">
              <label className="font-medium" htmlFor="model-base-url">
                接口地址
              </label>
              <Input
                className="mt-2 h-10 bg-background"
                id="model-base-url"
                onChange={(event) => update("baseUrl", event.target.value)}
                placeholder={
                  model.responsive
                    ? "https://api.example.com/v1"
                    : "https://api.example.com/v1/chat/completions"
                }
                value={model.baseUrl}
              />
              {isCatalogProvider(providerKey) ? (
                <Button
                  className="mt-2"
                  disabled={isLoadingProviderModels || isTesting || isSaving}
                  onClick={() => void refreshProviderModels()}
                  type="button"
                  variant="outline"
                >
                  <RefreshCw
                    className={isLoadingProviderModels ? "size-3.5 animate-spin" : "size-3.5"}
                  />
                  {isLoadingProviderModels
                    ? "获取中…"
                    : `从 ${providerPresets[providerKey].label} 获取模型`}
                </Button>
              ) : null}
            </div>
          ) : null}
          <div className="block text-sm">
            <label className="font-medium" htmlFor="model-api-key">
              API Key
            </label>
            <div className="relative mt-2">
              <Input
                className="h-10 bg-background pr-10"
                id="model-api-key"
                onChange={(event) => update("apiKey", event.target.value)}
                placeholder="输入你的 API Key"
                type={showKey ? "text" : "password"}
                value={model.apiKey}
              />
              <button
                aria-label={showKey ? "隐藏 API Key" : "显示 API Key"}
                className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                onClick={() => setShowKey((visible) => !visible)}
                type="button"
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>
          <div className="block text-sm">
            <label className="font-medium" htmlFor="model-name">
              模型名称
            </label>
            {isCatalogProvider(providerKey) ? (
              <>
                {providerKey === "openrouter" && presetModels.length > 0 ? (
                  <Input
                    className="mt-2 h-10 bg-background"
                    id="model-search"
                    onChange={(event) => {
                      setModelSearch(event.target.value);
                      setVisibleProviderModelCount(OPENROUTER_MODEL_PAGE_SIZE);
                    }}
                    placeholder="搜索模型名称或 slug"
                    value={modelSearch}
                  />
                ) : null}
                {isLoadingProviderModels && presetModels.length === 0 ? (
                  <div
                    aria-label="正在加载模型列表"
                    className="mt-2 h-10 w-full animate-pulse rounded-md bg-muted"
                    role="status"
                  />
                ) : (
                  <Select value={model.name} onValueChange={handlePresetModelChange}>
                    <SelectTrigger className="mt-2 h-10 w-full bg-background" id="model-name">
                      <SelectValue placeholder="先获取模型" />
                    </SelectTrigger>
                    <SelectContent>
                      {visiblePresetModels.map((preset) => (
                        <SelectItem key={preset.name} value={preset.name}>
                          {preset.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {providerKey === "openrouter" && filteredPresetModels.length > 0 ? (
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="text-muted-foreground text-xs">
                      已显示 {visiblePresetModels.length} / {filteredPresetModels.length}
                    </span>
                    {hasMoreProviderModels ? (
                      <Button
                        onClick={() =>
                          setVisibleProviderModelCount(
                            (count) => count + OPENROUTER_MODEL_PAGE_SIZE,
                          )
                        }
                        size="sm"
                        type="button"
                        variant="ghost"
                      >
                        加载更多
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <Input
                className="mt-2 h-10 bg-background"
                id="model-name"
                onChange={(event) => update("name", event.target.value)}
                placeholder="例如 gpt-4o 或 openai/gpt-4o"
                value={model.name}
              />
            )}
          </div>
          {providerKey === "custom" ||
          providerKey === "kimi" ||
          providerKey === "minimax" ||
          providerKey === "openrouter" ? (
            <fieldset>
              <legend className="font-medium text-sm">高级配置</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="工具调用"
                  checked={model.supportsTools}
                  onChange={(value) => update("supportsTools", value)}
                />
                <Toggle
                  label="图片输入"
                  checked={model.supportsImages}
                  onChange={(value) => update("supportsImages", value)}
                />
                <Toggle
                  label="思考模式"
                  checked={model.supportsReasoning}
                  onChange={(value) => update("supportsReasoning", value)}
                />
                <Toggle
                  label="自定义协议"
                  checked={model.customProtocol}
                  onChange={(value) => update("customProtocol", value)}
                />
                {providerKey === "custom" || providerKey === "minimax" ? (
                  <Toggle
                    label="Responses API"
                    checked={model.responsive}
                    onChange={handleResponsiveChange}
                  />
                ) : null}
              </div>
            </fieldset>
          ) : (
            <fieldset>
              <legend className="font-medium text-sm">高级配置</legend>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <Toggle
                  label="Responses API"
                  checked={model.responsive}
                  onChange={handleResponsiveChange}
                />
              </div>
              {model.responsive ? (
                <p className="mt-2 text-muted-foreground text-xs">
                  已切换为 Responses API，请求地址为 {DEEPSEEK_RESPONSES_BASE_URL}。
                </p>
              ) : null}
            </fieldset>
          )}
          {providerKey === "custom" ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <NumberField
                label="输入上限"
                presets={[
                  { label: "32K", value: 32_000 },
                  { label: "64K", value: 64_000 },
                  { label: "128K", value: 128_000 },
                  { label: "256K", value: 256_000 },
                ]}
                value={model.inputContext}
                onChange={(value) => update("inputContext", value)}
              />
              <NumberField
                label="输出上限"
                presets={[
                  { label: "8K", value: 8_000 },
                  { label: "16K", value: 16_000 },
                  { label: "32K", value: 32_000 },
                  { label: "64K", value: 64_000 },
                ]}
                value={model.outputContext}
                onChange={(value) => update("outputContext", value)}
              />
            </div>
          ) : null}
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-border border-t px-6 py-4">
          <div className="min-h-5 text-xs" role={testState ? "status" : undefined}>
            {testState?.type === "success" ? (
              <p className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                <CircleCheck className="size-3.5" />
                {testState.message}
              </p>
            ) : testState?.type === "error" ? (
              <p className="flex items-center gap-1.5 text-destructive">
                <CircleAlert className="size-3.5" />
                {testState.message}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button
              disabled={isSaving || isTesting}
              onClick={() => void testConnection()}
              type="button"
              variant="outline"
            >
              {isTesting ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <PlugZap className="size-3.5" />
              )}
              {isTesting ? "测试中…" : "测试 API"}
            </Button>
            <Button onClick={onClose} type="button" variant="outline">
              取消
            </Button>
            <Button disabled={isSaving || isTesting} type="submit">
              {isSaving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const inputId = `model-toggle-${label}`;

  return (
    <div className="flex items-center gap-2 text-sm">
      <Switch
        checked={checked}
        id={inputId}
        onCheckedChange={(value) => onChange(value === true)}
      />
      <label htmlFor={inputId}>{label}</label>
    </div>
  );
}

function NumberField({
  label,
  presets,
  value,
  onChange,
}: {
  label: string;
  presets: Array<{ label: string; value: number }>;
  value?: number;
  onChange: (value?: number) => void;
}) {
  return (
    <div className="block text-sm">
      <label className="font-medium" htmlFor={`model-${label}`}>
        {label}
      </label>
      <Input
        className="mt-2 h-10 bg-background"
        id={`model-${label}`}
        min="1"
        onChange={(event) => onChange(event.target.value ? Number(event.target.value) : undefined)}
        placeholder="使用提供商默认值"
        type="number"
        value={value ?? ""}
      />
      <div className="mt-2 flex flex-wrap gap-1.5">
        {presets.map((preset) => (
          <button
            aria-label={`设置${label}为 ${preset.label}`}
            className={`rounded-md px-2.5 py-1 text-xs transition-colors ${value === preset.value ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"}`}
            key={preset.value}
            onClick={() => onChange(preset.value)}
            type="button"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export {
  ApiKeysSettingsPage,
  ChatServerSettingsPage,
  DevelopmentSettingsPage,
  EnvironmentSettingsPage,
  FeishuChannelSettingsPage,
  GeneralSettingsPage,
  McpSettingsPage,
  MemorySettingsPage,
  ModelsSettingsPage,
  SandboxSettingsPage,
  SettingsLayout,
  ShortcutsSettingsPage,
  SkillsSettingsPage,
  SystemLogsSettingsPage,
  ThemeSettingsPage,
  ToolsSettingsPage,
};
