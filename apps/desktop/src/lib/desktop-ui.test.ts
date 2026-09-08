import { Context } from "cordis";
import { MessageCircle } from "lucide-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createDesktopUiRuntime,
  DesktopUiService,
  useDesktopUiSlot,
  type WorkspaceTabContribution,
  type WorkspaceTabRenderProps,
  type WorkspaceTabScope,
} from "@/lib/desktop-ui";
import type { DesktopPluginModule } from "@/plugin-api";

function EmptyPage() {
  return null;
}

describe("DesktopUiService", () => {
  it("orders, notifies, and disposes contributions", async () => {
    const ctx = new Context();
    await ctx.plugin(DesktopUiService);
    const listener = vi.fn();
    const unsubscribe = ctx.desktopUi.subscribe(listener);
    const disposeLater = ctx.desktopUi.register("sidebar.navigation", {
      id: "later",
      path: "/later",
      label: "Later",
      icon: MessageCircle,
      order: 20,
    });
    const disposeEarlier = ctx.desktopUi.register("sidebar.navigation", {
      id: "earlier",
      path: "/earlier",
      label: "Earlier",
      icon: MessageCircle,
      order: 10,
    });

    expect(ctx.desktopUi.getSnapshot("sidebar.navigation").map((item) => item.id)).toEqual([
      "earlier",
      "later",
    ]);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(() =>
      ctx.desktopUi.register("sidebar.navigation", {
        id: "earlier",
        path: "/duplicate",
        label: "Duplicate",
        icon: MessageCircle,
      }),
    ).toThrow("desktop UI contribution already registered");

    disposeEarlier();
    expect(ctx.desktopUi.getSnapshot("sidebar.navigation").map((item) => item.id)).toEqual([
      "later",
    ]);
    unsubscribe();
    disposeLater();
    await ctx.fiber.dispose();
  });

  it("keeps route and workspace tab slots ordered and isolated", async () => {
    const ctx = new Context();
    await ctx.plugin(DesktopUiService);
    const disposeRoute = ctx.desktopUi.register("route", {
      id: "route.later",
      path: "/later",
      title: "Later",
      icon: MessageCircle,
      keywords: ["later"],
      order: 20,
      component: EmptyPage,
    });
    ctx.desktopUi.register("route", {
      id: "route.earlier",
      path: "/earlier",
      title: "Earlier",
      icon: MessageCircle,
      keywords: ["earlier"],
      order: 10,
      component: EmptyPage,
    });
    ctx.desktopUi.register("workspace.tab", {
      id: "browser",
      label: "Browser",
      icon: MessageCircle,
      order: 30,
    });

    expect(ctx.desktopUi.getSnapshot("route").map((item) => item.id)).toEqual([
      "route.earlier",
      "route.later",
    ]);
    expect(ctx.desktopUi.getSnapshot("workspace.tab").map((item) => item.id)).toEqual(["browser"]);
    expect(() =>
      ctx.desktopUi.register("workspace.tab", {
        id: "browser",
        label: "Duplicate",
        icon: MessageCircle,
      }),
    ).toThrow("desktop UI contribution already registered");

    const routeSnapshot = ctx.desktopUi.getSnapshot("route");
    expect(ctx.desktopUi.getSnapshot("route")).toBe(routeSnapshot);
    disposeRoute();
    expect(ctx.desktopUi.getSnapshot("route").map((item) => item.id)).toEqual(["route.earlier"]);
    await ctx.fiber.dispose();
  });

  it("throws a clear error when a slot hook is used without its provider", () => {
    function Consumer() {
      useDesktopUiSlot("route");
      return null;
    }

    expect(() => renderToString(createElement(Consumer))).toThrow(
      "useDesktopUiSlot must be used within DesktopUiProvider",
    );
  });

  it("releases tracked workspace tabs exactly once, including service disposal", async () => {
    const ctx = new Context();
    await ctx.plugin(DesktopUiService);
    const onClose = vi.fn();
    ctx.desktopUi.register("workspace.tab", {
      id: "terminal",
      label: "Terminal",
      icon: MessageCircle,
      onClose,
    });
    const scope: WorkspaceTabScope = {
      workspaceId: "workspace",
      cwd: "/tmp/workspace",
      sessionId: null,
      messages: [],
      sideChatOpening: false,
      openSideChat: async () => undefined,
    };
    const first = { id: "first", type: "terminal", title: "Terminal", data: {} } as const;
    const second = { id: "second", type: "terminal", title: "Terminal 2", data: {} } as const;
    ctx.desktopUi.trackWorkspaceTabs([first, second], scope);

    await ctx.desktopUi.releaseWorkspaceTab(first, scope);
    await ctx.desktopUi.releaseWorkspaceTab(first, scope);
    await ctx.desktopUi.disposeWorkspaceTabs();

    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onClose.mock.calls.map(([tab]) => tab.id)).toEqual(["first", "second"]);
    await ctx.fiber.dispose();
  });

  it("boots all bundled contributions in the shared runtime", async () => {
    const runtime = await createDesktopUiRuntime("geek");
    const navigation = runtime.service.getSnapshot("sidebar.navigation");
    const settings = runtime.service.getSnapshot("settings.page");

    const routes = runtime.service.getSnapshot("route");
    const tabs = runtime.service.getSnapshot("workspace.tab");
    expect(navigation.map((item) => item.id)).toEqual(["chat"]);
    expect(routes.map((item) => item.id)).toEqual(["channels", "automations", "image-generation"]);
    expect(routes.filter((item) => item.navigation).map((item) => item.id)).toEqual([
      "channels",
      "automations",
    ]);
    expect(tabs.map((item) => item.id)).toEqual([
      "explorer",
      "terminal",
      "browser",
      "chat",
      "image",
      "plan",
      "context-detail",
    ]);
    expect(tabs.filter((item) => item.create).map((item) => item.id)).toEqual([
      "explorer",
      "terminal",
      "browser",
      "chat",
    ]);
    expect(settings.length).toBeGreaterThan(0);
    expect(new Set(settings.map((item) => item.id)).size).toBe(settings.length);
    expect(new Set(settings.map((item) => item.path)).size).toBe(settings.length);
    expect(settings.every((item) => item.label && item.keywords.length > 0)).toBe(true);
    expect(runtime.chatLayouts.getSnapshot().id).toBe("geek");

    await runtime.dispose();
    expect(runtime.service.getSnapshot("sidebar.navigation")).toEqual([]);
    expect(runtime.service.getSnapshot("settings.page")).toEqual([]);
    expect(runtime.service.getSnapshot("route")).toEqual([]);
    expect(runtime.service.getSnapshot("workspace.tab")).toEqual([]);
  });

  it("installs and uninstalls a plugin through the public module API", async () => {
    const closeTab = vi.fn();
    const runAction = vi.fn();
    const plugin: DesktopPluginModule = {
      name: "test.public-api",
      inject: ["desktopUi", "chatLayouts"],
      apply(ctx) {
        ctx.effect(() => {
          const disposers = [
            ctx.desktopUi.register("sidebar.navigation", {
              id: "plugin.navigation",
              path: "/plugin",
              label: "Plugin",
              icon: MessageCircle,
            }),
            ctx.desktopUi.register("route", {
              id: "plugin.route",
              path: "/plugin",
              title: "Plugin",
              icon: MessageCircle,
              keywords: ["plugin"],
              component: EmptyPage,
            }),
            ctx.desktopUi.register("settings.page", {
              id: "plugin.settings",
              path: "plugin",
              label: "Plugin",
              icon: MessageCircle,
              keywords: ["plugin"],
              component: EmptyPage,
            }),
            ctx.desktopUi.register("workspace.tab", {
              id: "blank",
              label: "Plugin tab",
              icon: MessageCircle,
              onClose: closeTab,
            }),
            ctx.desktopUi.register("action", {
              id: "plugin.action",
              label: "Plugin action",
              icon: MessageCircle,
              keywords: ["plugin"],
              run: runAction,
            }),
            ctx.desktopUi.register("shell.overlay", {
              id: "plugin.overlay",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("sidebar.footer", {
              id: "plugin.sidebar-footer",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.header.action", {
              id: "plugin.chat-header-action",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.composer.tool", {
              id: "plugin.chat-composer-tool",
              component: EmptyPage,
            }),
            ctx.chatLayouts.register("plugin-layout", ({ children }) => children),
          ];
          return () =>
            disposers.reverse().forEach((dispose) => {
              dispose();
            });
        }, "test public plugin contributions");
      },
    };
    const runtime = await createDesktopUiRuntime("standard", [plugin]);

    expect(runtime.pluginResults[runtime.pluginResults.length - 1]?.ok).toBe(true);
    const navigation = runtime.service.getSnapshot("sidebar.navigation");
    expect(navigation.some((item) => item.id === "plugin.navigation")).toBe(true);
    const routes = runtime.service.getSnapshot("route");
    expect(routes.some((item) => item.id === "plugin.route")).toBe(true);
    const settings = runtime.service.getSnapshot("settings.page");
    expect(settings.some((item) => item.id === "plugin.settings")).toBe(true);
    const action = runtime.service
      .getSnapshot("action")
      .find((item) => item.id === "plugin.action");
    expect(action).toBeDefined();
    await action?.run({ pathname: "/chat", navigate: vi.fn() });
    expect(runAction).toHaveBeenCalledOnce();
    expect(runtime.service.getSnapshot("shell.overlay").map((item) => item.id)).toEqual([
      "plugin.overlay",
    ]);
    expect(runtime.service.getSnapshot("sidebar.footer").map((item) => item.id)).toEqual([
      "plugin.sidebar-footer",
    ]);
    expect(runtime.service.getSnapshot("chat.header.action").map((item) => item.id)).toEqual([
      "plugin.chat-header-action",
    ]);
    expect(runtime.service.getSnapshot("chat.composer.tool").map((item) => item.id)).toEqual([
      "plugin.chat-composer-tool",
    ]);
    expect(runtime.chatLayouts.getSnapshot().id).toBe("standard");
    runtime.chatLayouts.activate("plugin-layout");
    expect(runtime.chatLayouts.getSnapshot().id).toBe("plugin-layout");

    const scope: WorkspaceTabScope = {
      workspaceId: "workspace",
      cwd: "/tmp/workspace",
      sessionId: null,
      messages: [],
      sideChatOpening: false,
      openSideChat: async () => undefined,
    };
    runtime.service.trackWorkspaceTabs(
      [{ id: "plugin-tab", type: "blank", title: "Plugin", data: {} }],
      scope,
    );
    expect(await runtime.uninstallPlugin(plugin.name)).toBe(true);
    expect(runtime.service.getSnapshot("route").some((item) => item.id === "plugin.route")).toBe(
      false,
    );
    expect(runtime.service.getSnapshot("action")).toEqual([]);
    expect(runtime.service.getSnapshot("shell.overlay")).toEqual([]);
    expect(runtime.service.getSnapshot("sidebar.footer")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.header.action")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.composer.tool")).toEqual([]);
    expect(() => runtime.chatLayouts.activate("plugin-layout")).toThrow("unknown chat layout");

    await runtime.dispose();
    expect(closeTab).toHaveBeenCalledOnce();
  });

  it("supports plugin-defined workspace tab types and data", async () => {
    type InspectorData = { resourceId: string; expanded: boolean };
    const onClose = vi.fn();
    function InspectorTab({ tab }: WorkspaceTabRenderProps<"plugin.inspector", InspectorData>) {
      return tab.data.resourceId;
    }
    const contribution = {
      id: "plugin.inspector",
      label: "Inspector",
      icon: MessageCircle,
      renderer: InspectorTab,
      create: () => ({
        id: "inspector-1",
        type: "plugin.inspector" as const,
        title: "Inspector",
        data: { resourceId: "resource-1", expanded: false },
      }),
      onClose,
    } satisfies WorkspaceTabContribution<"plugin.inspector", InspectorData>;
    const runtime = await createDesktopUiRuntime("standard", [
      {
        name: "test.custom-workspace-tab",
        inject: ["desktopUi"],
        apply(ctx) {
          return ctx.desktopUi.register("workspace.tab", contribution);
        },
      },
    ]);

    const registered = runtime.service
      .getSnapshot("workspace.tab")
      .find((item) => item.id === contribution.id);
    expect(registered).toBeDefined();
    const tab = contribution.create();
    expect(tab.data.resourceId).toBe("resource-1");

    const scope = {
      workspaceId: "workspace",
      cwd: "/tmp/workspace",
      sessionId: null,
      messages: [],
      sideChatOpening: false,
      openSideChat: async () => undefined,
    } satisfies WorkspaceTabScope;
    runtime.service.trackWorkspaceTabs([tab], scope);
    await runtime.uninstallPlugin("test.custom-workspace-tab");
    expect(onClose).toHaveBeenCalledWith(tab, scope);

    await runtime.dispose();
  });

  it("isolates plugin failures and rejects duplicate plugin names", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const failing: DesktopPluginModule = {
      name: "test.failing",
      apply() {
        throw new Error("plugin exploded");
      },
    };
    const healthy: DesktopPluginModule = {
      name: "test.healthy",
      inject: ["desktopUi"],
      apply(ctx) {
        return ctx.desktopUi.register("sidebar.navigation", {
          id: "healthy.navigation",
          path: "/healthy",
          label: "Healthy",
          icon: MessageCircle,
        });
      },
    };
    const runtime = await createDesktopUiRuntime("standard", [failing, healthy]);

    expect(runtime.pluginResults[runtime.pluginResults.length - 2]).toMatchObject({
      ok: false,
      name: "test.failing",
    });
    expect(runtime.pluginResults[runtime.pluginResults.length - 1]).toMatchObject({
      ok: true,
      name: "test.healthy",
    });
    expect(
      runtime.service
        .getSnapshot("sidebar.navigation")
        .some((item) => item.id === "healthy.navigation"),
    ).toBe(true);

    const duplicate = await runtime.installPlugin(healthy);
    expect(duplicate.ok).toBe(false);
    if (!duplicate.ok) expect(duplicate.error.message).toContain("already installed");

    const contributionCollision = await runtime.installPlugin({
      name: "test.colliding-contribution",
      inject: ["desktopUi"],
      apply(ctx) {
        return ctx.desktopUi.register("sidebar.navigation", {
          id: "healthy.navigation",
          path: "/collision",
          label: "Collision",
          icon: MessageCircle,
        });
      },
    });
    expect(contributionCollision.ok).toBe(false);
    if (!contributionCollision.ok) {
      expect(contributionCollision.error.message).toContain("contribution already registered");
    }

    await runtime.dispose();
    errorSpy.mockRestore();
  });
});
