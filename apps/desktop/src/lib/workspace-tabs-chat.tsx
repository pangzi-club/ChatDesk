import type { DesktopPluginModule } from "@chatdesk/desktop-plugin-sdk";
import type { Context } from "cordis";
import { MessageSquarePlus } from "lucide-react";
import { SideChatTabRenderer } from "@/components/workspace-tab-renderers";
import { deleteChatServerSession, stopChatServerRun } from "@/lib/chat-server";
import type { WorkspaceTabContribution } from "@/lib/desktop-ui";

export const manifest = {
  id: "workspace-tabs-chat",
  version: "1.0.0",
  apiVersion: 1,
  entry: "lib/workspace-tabs-chat",
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
