import type { Context } from "cordis";
import {
  ChartColumn,
  FolderGit2,
  Globe2,
  Image,
  MessageSquarePlus,
  ScrollText,
  SquareTerminal,
} from "lucide-react";
import {
  BrowserTabRenderer,
  ContextDetailTabRenderer,
  ImageTabRenderer,
  PlanTabRenderer,
  SideChatTabRenderer,
  TerminalTabRenderer,
} from "@/components/workspace-tab-renderers";
import { deleteChatServerSession, stopChatServerRun } from "@/lib/chat-server";
import type { WorkspaceTab } from "@/lib/desktop-ui";
import { terminalSessions } from "@/lib/terminal";
import type { DesktopPluginModule } from "@/plugin-api";

function tabId() {
  return `chat-window-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const name = "workspace-tab-builtins";
export const inject: DesktopPluginModule["inject"] = ["desktopUi"];

export function apply(ctx: Context) {
  ctx.effect(() => {
    const disposers = [
      ctx.desktopUi.register("workspace.tab", {
        id: "explorer",
        label: "Workspace Explorer",
        compactLabel: "Explorer",
        icon: FolderGit2,
        order: 10,
        isAvailable: (scope) => Boolean(scope.workspaceId && scope.cwd),
        create: (scope): WorkspaceTab<"explorer"> => ({
          id: tabId(),
          type: "explorer",
          title: "Explorer",
          data: { workspaceId: scope.workspaceId, cwd: scope.cwd, view: "files" },
        }),
      }),
      ctx.desktopUi.register("workspace.tab", {
        id: "terminal",
        label: "Terminal",
        icon: SquareTerminal,
        order: 20,
        renderer: TerminalTabRenderer,
        isAvailable: (scope) => Boolean(scope.cwd),
        create: (scope): WorkspaceTab<"terminal"> => ({
          id: tabId(),
          type: "terminal",
          title: "Terminal",
          data: { cwd: scope.cwd },
        }),
        onClose: (tab) => terminalSessions.close(tab.id),
      }),
      ctx.desktopUi.register("workspace.tab", {
        id: "browser",
        label: "Browser",
        icon: Globe2,
        order: 30,
        renderer: BrowserTabRenderer,
        create: (): WorkspaceTab<"browser"> => ({
          id: tabId(),
          type: "browser",
          title: "Browser",
          data: {},
        }),
      }),
      ctx.desktopUi.register("workspace.tab", {
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
      }),
      ctx.desktopUi.register("workspace.tab", {
        id: "image",
        label: "图片预览",
        icon: Image,
        order: 50,
        renderer: ImageTabRenderer,
      }),
      ctx.desktopUi.register("workspace.tab", {
        id: "plan",
        label: "计划",
        icon: ScrollText,
        order: 60,
        renderer: PlanTabRenderer,
      }),
      ctx.desktopUi.register("workspace.tab", {
        id: "context-detail",
        label: "上下文",
        icon: ChartColumn,
        order: 70,
        renderer: ContextDetailTabRenderer,
      }),
    ];
    return () =>
      disposers.reverse().forEach((dispose) => {
        dispose();
      });
  }, "workspace tab builtin contributions");
}
