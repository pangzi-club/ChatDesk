import type { DesktopPluginModule } from "@chatdesk/desktop-plugin-sdk";
import type { Context } from "cordis";
import { MessageSquarePlus } from "lucide-react";
import { SideChatTabRenderer } from "@/components/workspace-tab-renderers";
import type { WorkspaceTabContribution } from "@/lib/plugins/desktop-ui";
import { deleteChatServerSession, stopChatServerRun } from "@/lib/server/chat-server";

export const manifest = {
  id: "workspace-tabs-chat",
  builtin: true,
  name: "侧边聊天",
  description: "在工作区中打开可独立使用的侧边聊天标签，并自动管理会话资源。",
  version: "1.0.0",
  apiVersion: 1,
  entry: "plugins/workspace-tabs-chat",
  contributes: ["workspace.tab"],
  permissions: [],
} as const;
export const inject: DesktopPluginModule["inject"] = ["desktopUi"];

export function apply(ctx: Context) {
  ctx.effect(() => {
    const dispose = ctx.desktopUi.register("workspace.tab", {
      id: "chat",
      label: "侧边聊天",
      icon: MessageSquarePlus,
      order: 40,
      renderer: SideChatTabRenderer,
      isAvailable: (scope) => !scope.sideChatOpening,
      create: (scope) => scope.openSideChat(),
      onClose: async (tab) => {
        if (!tab.data.sessionId) return;
        await stopChatServerRun(tab.data.sessionId).catch(() => undefined);
        await deleteChatServerSession(tab.data.sessionId);
      },
    } satisfies WorkspaceTabContribution<"chat">);
    return dispose;
  }, "chat workspace tab contribution");
}
