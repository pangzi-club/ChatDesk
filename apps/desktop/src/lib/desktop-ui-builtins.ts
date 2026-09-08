import type { Context } from "cordis";
import {
  Bell,
  Bot,
  Brain,
  ChartColumn,
  Clock3,
  FlaskConical,
  Keyboard,
  KeyRound,
  MessageCircle,
  MessageSquare,
  Mic,
  Monitor,
  Package,
  Palette,
  PlugZap,
  ScrollText,
  Server,
  ShieldCheck,
  Sparkles,
  SquareTerminal,
  Wrench,
} from "lucide-react";
import { AutomationsPage } from "@/pages/automations";
import { ChannelsPage } from "@/pages/channels";
import { ImageGenerationPage } from "@/pages/image-generation";
import {
  AgentsSettingsPage,
  ApiKeysSettingsPage,
  ChatServerSettingsPage,
  ComputerUseSettingsPage,
  DevelopmentSettingsPage,
  EnvironmentSettingsPage,
  FeishuChannelSettingsPage,
  GeneralSettingsPage,
  McpSettingsPage,
  MemorySettingsPage,
  ModelsSettingsPage,
  SandboxSettingsPage,
  ShortcutsSettingsPage,
  SkillsSettingsPage,
  SystemLogsSettingsPage,
  ThemeSettingsPage,
  ToolsSettingsPage,
} from "@/pages/settings";
import { StatisticsSettingsPage } from "@/pages/statistics";
import { VoiceSettingsPage } from "@/pages/voice-settings";

const settings = [
  [
    "general",
    "常规",
    Bell,
    ["设置", "settings", "常规", "通知", "系统通知", "对话完成"],
    GeneralSettingsPage,
  ],
  [
    "theme",
    "主题",
    Palette,
    ["设置", "theme", "外观", "配色", "颜色", "Chat 布局", "标准", "可爱", "Geek", "UI"],
    ThemeSettingsPage,
  ],
  [
    "shortcuts",
    "快捷键",
    Keyboard,
    ["设置", "快捷键", "shortcut", "hotkey", "键盘"],
    ShortcutsSettingsPage,
  ],
  ["models", "模型", Package, ["设置", "models", "model"], ModelsSettingsPage],
  ["agents", "Agents", Bot, ["设置", "agents", "agent", "智能体", "助手"], AgentsSettingsPage],
  [
    "channel",
    "Channel",
    MessageSquare,
    ["设置", "飞书", "channel", "消息"],
    FeishuChannelSettingsPage,
  ],
  [
    "mcp",
    "MCP",
    PlugZap,
    ["设置", "mcp", "模型上下文协议", "插件", "服务器", "工具"],
    McpSettingsPage,
  ],
  [
    "skills",
    "Skills",
    Sparkles,
    ["设置", "skills", "skill", "技能", "提示词", "工作流", "agents"],
    SkillsSettingsPage,
  ],
  ["tools", "Tools", Wrench, ["设置", "tools", "工具", "工具包", "chat tools"], ToolsSettingsPage],
  [
    "sandbox",
    "沙箱",
    ShieldCheck,
    ["设置", "sandbox", "沙箱", "读取白名单", "目录权限"],
    SandboxSettingsPage,
  ],
  ["memory", "长期记忆", Brain, ["设置", "memory", "记忆", "长期记忆"], MemorySettingsPage],
  ["voice", "语音", Mic, ["设置", "voice", "语音输入"], VoiceSettingsPage],
  [
    "environment",
    "环境",
    SquareTerminal,
    ["设置", "环境", "environment", "path", "node", "pnpm", "python", "go"],
    EnvironmentSettingsPage,
  ],
  [
    "development",
    "开发",
    FlaskConical,
    [
      "设置",
      "开发",
      "development",
      "mock",
      "长文本",
      "流式",
      "性能测试",
      "sidebar",
      "channel",
      "自动化",
    ],
    DevelopmentSettingsPage,
  ],
  [
    "keys",
    "其他密钥",
    KeyRound,
    ["设置", "密钥", "其他密钥", "API Keys", "api"],
    ApiKeysSettingsPage,
  ],
  [
    "chat-server",
    "Chat Server",
    Server,
    ["设置", "chat", "server", "端口", "localhost", "hono"],
    ChatServerSettingsPage,
  ],
  [
    "computer-use",
    "Computer Use",
    Monitor,
    ["设置", "computer use", "电脑操作", "辅助功能", "录屏", "系统录音"],
    ComputerUseSettingsPage,
  ],
  [
    "statistics",
    "使用量",
    ChartColumn,
    ["设置", "使用量", "usage", "token", "统计", "历史", "归档", "导入"],
    StatisticsSettingsPage,
  ],
  [
    "logs",
    "活动记录",
    ScrollText,
    ["设置", "活动", "记录", "日志", "logs"],
    SystemLogsSettingsPage,
  ],
] as const;

export const name = "desktop-ui-builtins";
export const inject = ["desktopUi"];

export function apply(ctx: Context) {
  ctx.effect(() => {
    const disposers = [
      ctx.desktopUi.register("sidebar.navigation", {
        id: "chat",
        path: "/chat",
        label: "Chat",
        icon: MessageCircle,
        section: "primary",
        order: 10,
        keywords: ["对话", "聊天"],
      }),
      ctx.desktopUi.register("route", {
        id: "channels",
        path: "/channels",
        title: "Channel",
        icon: MessageSquare,
        keywords: ["飞书", "消息", "联系人", "channel"],
        order: 20,
        navigation: { label: "Channel", section: "secondary" },
        component: ChannelsPage,
      }),
      ctx.desktopUi.register("route", {
        id: "automations",
        path: "/automations",
        title: "Automations",
        icon: Clock3,
        keywords: ["自动化", "任务"],
        order: 30,
        navigation: { label: "Automations", section: "secondary" },
        component: AutomationsPage,
      }),
      ctx.desktopUi.register("route", {
        id: "image-generation",
        path: "/image-generation",
        title: "Image Generation",
        icon: Sparkles,
        keywords: ["图片", "图像", "生成"],
        order: 40,
        component: ImageGenerationPage,
      }),
      ...settings.map(([path, label, icon, keywords, component], index) =>
        ctx.desktopUi.register("settings.page", {
          id: `settings.${path}`,
          path,
          label,
          icon,
          keywords: [...keywords],
          order: index,
          layout: "standard",
          component,
        }),
      ),
    ];
    return () =>
      disposers.reverse().forEach((dispose) => {
        dispose();
      });
  }, "desktop UI builtin contributions");
}
