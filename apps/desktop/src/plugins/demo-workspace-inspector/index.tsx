import { defineDesktopPlugin, type WorkspaceTabContribution } from "@chatdesk/desktop-plugin-sdk";
import { Search } from "lucide-react";

function Inspector({ tab }: { tab: { title: string } }) {
  return (
    <div className="h-full bg-background p-6">
      <h2 className="font-semibold">{tab.title}</h2>
      <p className="mt-2 text-muted-foreground text-sm">这是一个由插件创建的 workspace tab。</p>
    </div>
  );
}
const contribution = {
  id: "demo-inspector",
  label: "Inspector",
  icon: Search,
  renderer: Inspector,
  create: () => ({
    id: `demo-inspector-${Date.now()}`,
    type: "demo-inspector",
    title: "Workspace Inspector",
    data: { createdAt: Date.now() },
  }),
  onClose: () => undefined,
} as unknown as WorkspaceTabContribution<"demo-inspector", { createdAt: number }>;
const plugin = defineDesktopPlugin({
  manifest: {
    id: "demo-workspace-inspector",
    name: "Workspace Inspector",
    description:
      "注册一个可从 Workspace 新建菜单打开的自定义 Tab，用于验证渲染及卸载时的资源清理。",
    version: "1.0.0",
    apiVersion: 1,
    entry: "plugins/demo-workspace-inspector",
    contributes: ["workspace.tab"],
    permissions: [],
  },
  inject: ["desktopUi"],
  apply(ctx) {
    ctx.effect(
      () => ctx.desktopUi.register("workspace.tab", contribution as never),
      "workspace inspector demo",
    );
  },
});

export const manifest = plugin.manifest;
export const inject = plugin.inject;
export const apply = plugin.apply;
