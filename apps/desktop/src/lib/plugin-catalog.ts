import { Blocks, Clock3, Search, Sparkles } from "lucide-react";
import type { ComponentType } from "react";
import type { DiscoveredPlugin } from "@/lib/desktop-plugin-discovery";

type PluginIcon = ComponentType<{ className?: string }>;

const iconById: Record<string, PluginIcon> = {
  "demo-command-palette": Sparkles,
  "demo-pomodoro": Clock3,
  "demo-workspace-inspector": Search,
};

const contributionLabels: Record<string, { label: string; description: string }> = {
  action: { label: "命令", description: "向命令菜单和快捷操作提供能力" },
  "chat.composer.tool": { label: "聊天工具", description: "在聊天输入区提供辅助工具" },
  "chat.header.action": { label: "聊天操作", description: "在聊天标题栏提供快捷操作" },
  route: { label: "页面", description: "提供一个可从应用导航打开的页面" },
  "settings.page": { label: "设置页面", description: "向设置中心添加一个页面" },
  "sidebar.navigation": { label: "侧边栏", description: "在应用侧边栏添加导航入口" },
  "shell.overlay": { label: "浮层", description: "在应用外壳中显示浮层内容" },
  "shell.before": { label: "外壳前置", description: "在应用外壳内容前插入界面" },
  "shell.after": { label: "外壳后置", description: "在应用外壳内容后插入界面" },
  "sidebar.before": { label: "侧边栏前置", description: "在侧边栏内容前插入界面" },
  "sidebar.after": { label: "侧边栏后置", description: "在侧边栏内容后插入界面" },
  "sidebar.footer": { label: "侧边栏底部", description: "在侧边栏底部提供内容" },
  "workspace.tab": { label: "工作区标签", description: "向工作区标签栏添加可用工具" },
};

export function getPluginIcon(plugin: DiscoveredPlugin): PluginIcon {
  return iconById[plugin.manifest?.id ?? ""] ?? Blocks;
}

export function getPluginCategory(plugin: DiscoveredPlugin) {
  const contributes = plugin.manifest?.contributes ?? [];
  if (contributes.some((item) => item.includes("chat"))) return "聊天与工作流";
  if (contributes.includes("workspace.tab")) return "工作区";
  if (contributes.includes("route") || contributes.includes("settings.page")) return "生产力";
  return "精选";
}

export function getContributionInfo(slot: string) {
  return contributionLabels[slot] ?? { label: slot, description: "提供桌面端扩展能力" };
}

export function getPluginSearchText(plugin: DiscoveredPlugin) {
  const manifest = plugin.manifest;
  return [
    manifest?.id,
    manifest?.name,
    manifest?.description,
    ...(manifest?.contributes ?? []),
    ...plugin.errors.map((item) => item.message),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();
}

export function getPluginExamples(plugin: DiscoveredPlugin) {
  const name = plugin.manifest?.name ?? plugin.manifest?.id ?? "这个插件";
  const contributes = plugin.manifest?.contributes ?? [];
  const examples: string[] = [];
  if (contributes.includes("route")) examples.push(`打开 ${name} 页面`);
  if (contributes.includes("workspace.tab")) examples.push(`在工作区中使用 ${name}`);
  if (contributes.includes("action")) examples.push(`运行 ${name} 提供的命令`);
  if (contributes.includes("sidebar.navigation")) examples.push(`从侧边栏进入 ${name}`);
  return examples.length ? examples : [`在 ChatDesk 中使用 ${name}`];
}
