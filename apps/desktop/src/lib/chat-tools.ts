import type {
  ChatToolPackId,
  ChatToolsSettings as SharedChatToolsSettings,
} from "@chatdesk/shared";
import { loadChatServerConfig, saveChatServerConfig } from "@/lib/chat-server";

export type { ChatToolPackId } from "@chatdesk/shared";
export type ChatToolsSettings = SharedChatToolsSettings;

export const WORKSPACE_FILE_TOOL_META: Array<{
  id: "list_dir" | "search_files" | "read_file" | "write_file" | "edit_file";
  label: string;
  description: string;
}> = [
  { id: "list_dir", label: "列出目录", description: "浏览文件和子目录" },
  { id: "search_files", label: "搜索文件", description: "按名称或内容查找" },
  { id: "read_file", label: "读取文件", description: "查看文本文件内容" },
  { id: "write_file", label: "写入文件", description: "创建或覆盖文件" },
  { id: "edit_file", label: "编辑文件", description: "精确替换文件内容" },
];

export const DEFAULT_CHAT_TOOLS: ChatToolsSettings = {
  list_dir: false,
  search_files: false,
  read_file: false,
  write_file: false,
  edit_file: false,
  git: false,
  terminal: false,
  web_search: false,
  image_generation: false,
  browser: false,
};

export type ChatToolPackMeta = {
  id: ChatToolPackId;
  label: string;
  description: string;
  examples: string[];
  /** 业务 API Key 名称；缺省表示不需要额外 Key（如 provider 内置工具）。 */
  keyLabel?: string;
  keysPath?: "/settings/keys";
  /** 需要模型开启 Responses API（如 OpenAI web_search）。 */
  requiresResponsive?: boolean;
  category: "development" | "web";
  toolNames: string[];
  requiresWorkspace?: boolean;
  risk?: string;
};

export const CHAT_TOOL_CATEGORIES = [
  { id: "development", label: "本地开发" },
  { id: "web", label: "联网与创作" },
] as const;

export const CHAT_TOOL_PACKS: ChatToolPackMeta[] = [
  ...WORKSPACE_FILE_TOOL_META.map((item) => ({
    id: item.id,
    label: item.label,
    category: "development" as const,
    toolNames: item.id === "edit_file" ? ["edit_file", "apply_patch"] : [item.id],
    requiresWorkspace: true,
    description: item.description,
    examples: [item.description],
  })),
  {
    id: "git",
    label: "Git",
    category: "development",
    toolNames: ["git"],
    requiresWorkspace: true,
    description: "创建分支、查看状态和提交 workspace 改动。",
    examples: ["创建一个功能分支", "提交当前改动"],
    risk: "会修改当前 workspace 的 Git 分支或提交历史。",
  },
  {
    id: "terminal",
    label: "终端",
    category: "development",
    toolNames: ["bash"],
    requiresWorkspace: true,
    risk: "完全访问：命令可能修改 workspace 外部环境。",
    description: "在当前 workspace 中执行 Shell 命令；必须先选择 workspace。",
    examples: ["运行测试并告诉我失败原因", "查看当前 Git 状态", "启动一次构建"],
  },
  {
    id: "web_search",
    label: "Web Search",
    description: "通过 Responses API 联网搜索近期公开信息（OpenAI web_search）。",
    examples: [
      "上周旧金山发生了什么？",
      "搜索今天 AI 领域的重要新闻",
      "查一下这个库的最新 release",
    ],
    requiresResponsive: true,
    category: "web",
    toolNames: ["web_search"],
  },
  {
    id: "image_generation",
    label: "Image Generation",
    description: "通过 KIE 创建生图任务并轮询结果（与独立 Image 页同一后端）。",
    examples: [
      "画一只坐在窗台上的橘猫",
      "生成一张赛博朋克风格的城市夜景",
      "做一张极简产品海报插画",
    ],
    keyLabel: "KIE API Key",
    keysPath: "/settings/keys",
    category: "web",
    toolNames: ["image_generation"],
  },
  {
    id: "browser",
    label: "Browser",
    description: "控制隔离的 Headless Chromium 页面；不继承用户现有登录态。",
    examples: ["打开这个网页并截图", "点击页面上的登录按钮", "读取当前页面标题"],
    category: "web",
    toolNames: [
      "browser_open",
      "browser_screenshot",
      "browser_click",
      "browser_eval",
      "browser_close",
    ],
    risk: "高风险：可导航、点击并执行当前页面 JavaScript。",
  },
];

function isChatToolPackId(value: unknown): value is ChatToolPackId {
  return (
    value === "list_dir" ||
    value === "search_files" ||
    value === "read_file" ||
    value === "write_file" ||
    value === "edit_file" ||
    value === "git" ||
    value === "terminal" ||
    value === "web_search" ||
    value === "image_generation" ||
    value === "browser"
  );
}

function normalizeChatTools(value: unknown): ChatToolsSettings {
  if (!value || typeof value !== "object") {
    return { ...DEFAULT_CHAT_TOOLS };
  }
  const record = value as Record<string, unknown>;
  const legacyWorkspaceFiles = record.workspace_files === true;
  const legacyChildren =
    record.workspaceFileTools && typeof record.workspaceFileTools === "object"
      ? (record.workspaceFileTools as Record<string, unknown>)
      : {};
  return {
    list_dir: record.list_dir === true || legacyWorkspaceFiles || legacyChildren.list_dir === true,
    search_files:
      record.search_files === true || legacyWorkspaceFiles || legacyChildren.search_files === true,
    read_file:
      record.read_file === true || legacyWorkspaceFiles || legacyChildren.read_file === true,
    write_file:
      record.write_file === true || legacyWorkspaceFiles || legacyChildren.write_file === true,
    edit_file:
      record.edit_file === true || legacyWorkspaceFiles || legacyChildren.edit_file === true,
    git: record.git === true,
    terminal: record.terminal === true,
    web_search: record.web_search === true,
    image_generation: record.image_generation === true,
    browser: record.browser === true,
  };
}

export async function loadChatToolsSettings(): Promise<ChatToolsSettings> {
  try {
    const config = await loadChatServerConfig();
    if (Object.keys(config.chatTools).length > 0) return normalizeChatTools(config.chatTools);
  } catch (error) {
    console.error("Failed to load Chat Server tools settings", error);
  }
  return { ...DEFAULT_CHAT_TOOLS };
}

export async function saveChatToolsSettings(settings: ChatToolsSettings) {
  const next = normalizeChatTools(settings);
  await saveChatServerConfig({ chatTools: next });
}

export function getEnabledPackIds(settings: ChatToolsSettings): ChatToolPackId[] {
  return CHAT_TOOL_PACKS.map((pack) => pack.id).filter((id) => settings[id]);
}

export function getPackMeta(id: ChatToolPackId): ChatToolPackMeta {
  const pack = CHAT_TOOL_PACKS.find((item) => item.id === id);
  if (!pack) {
    throw new Error(`Unknown chat tool pack: ${id}`);
  }
  return pack;
}

export function isChatToolPackEnabled(
  settings: ChatToolsSettings,
  id: string,
): id is ChatToolPackId {
  return isChatToolPackId(id) && settings[id] === true;
}
