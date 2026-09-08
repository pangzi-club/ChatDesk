import type { DesktopPluginModule } from "@chatdesk/desktop-plugin-sdk";
import type { Context } from "cordis";
import { FolderGit2, Globe2, SquareTerminal } from "lucide-react";
import { BrowserTabRenderer, TerminalTabRenderer } from "@/components/workspace-tab-renderers";
import type { WorkspaceTab, WorkspaceTabContribution } from "@/lib/desktop-ui";
import { terminalSessions } from "@/lib/terminal";
import { tabId } from "@/lib/workspace-tab-utils";

export const manifest = {
  id: "workspace-tabs-core",
  version: "1.0.0",
  apiVersion: 1,
  entry: "lib/workspace-tabs-core",
  contributes: ["workspace.tab"],
  permissions: [],
} as const;
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
      } satisfies WorkspaceTabContribution<"explorer">),
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
      } satisfies WorkspaceTabContribution<"terminal">),
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
      } satisfies WorkspaceTabContribution<"browser">),
    ];
    return () => {
      disposers.reverse().forEach((dispose) => {
        dispose();
      });
    };
  }, "core workspace tab contributions");
}
