import type { DesktopPluginModule } from "@chatdesk/desktop-plugin-sdk";
import type { Context } from "cordis";
import { ChartColumn, Image, ScrollText } from "lucide-react";
import {
  ContextDetailTabRenderer,
  ImageTabRenderer,
  PlanTabRenderer,
} from "@/components/workspace-tab-renderers";
import type { WorkspaceTabContribution } from "@/lib/desktop-ui";

export const manifest = {
  id: "workspace-tabs-content",
  builtin: true,
  name: "内容预览标签",
  description: "提供图片、计划和上下文详情等内容型 Workspace 标签。",
  version: "1.0.0",
  apiVersion: 1,
  entry: "plugins/workspace-tabs-content",
  contributes: ["workspace.tab"],
  permissions: [],
} as const;
export const inject: DesktopPluginModule["inject"] = ["desktopUi"];

export function apply(ctx: Context) {
  ctx.effect(() => {
    const disposers = [
      ctx.desktopUi.register("workspace.tab", {
        id: "image",
        label: "图片预览",
        icon: Image,
        order: 50,
        renderer: ImageTabRenderer,
      } satisfies WorkspaceTabContribution<"image">),
      ctx.desktopUi.register("workspace.tab", {
        id: "plan",
        label: "计划",
        icon: ScrollText,
        order: 60,
        renderer: PlanTabRenderer,
      } satisfies WorkspaceTabContribution<"plan">),
      ctx.desktopUi.register("workspace.tab", {
        id: "context-detail",
        label: "上下文",
        icon: ChartColumn,
        order: 70,
        renderer: ContextDetailTabRenderer,
      } satisfies WorkspaceTabContribution<"context-detail">),
    ];
    return () => {
      disposers.reverse().forEach((dispose) => {
        dispose();
      });
    };
  }, "content workspace tab contributions");
}
