import { Context } from "cordis";
import { MessageCircle } from "lucide-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createDesktopUiRuntime,
  DesktopUiService,
  type DesktopUiSlot,
  useDesktopUiSlot,
  type WorkspaceTabContribution,
  type WorkspaceTabRenderProps,
  type WorkspaceTabScope,
} from "@/lib/desktop-ui";
import type { DesktopPluginModule } from "@/plugin-api";

function EmptyPage() {
  return null;
}

function manifest(id: string, contributes: readonly DesktopUiSlot[] = []) {
  return {
    id,
    version: "1.0.0",
    apiVersion: 1 as const,
    entry: `test/${id}`,
    contributes,
    permissions: [],
  } as const;
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

  it("orders chat region and message action contributions and rejects duplicates", async () => {
    const ctx = new Context();
    await ctx.plugin(DesktopUiService);
    ctx.desktopUi.register("chat.composer.float", {
      id: "float.second",
      order: 20,
      component: EmptyPage,
    });
    ctx.desktopUi.register("chat.composer.float", {
      id: "float.first",
      order: 10,
      component: EmptyPage,
    });
    ctx.desktopUi.register("chat.message.action", {
      id: "action.pin",
      component: EmptyPage,
    });

    expect(ctx.desktopUi.getSnapshot("chat.composer.float").map((item) => item.id)).toEqual([
      "float.first",
      "float.second",
    ]);
    expect(ctx.desktopUi.getSnapshot("chat.message.action").map((item) => item.id)).toEqual([
      "action.pin",
    ]);
    expect(() =>
      ctx.desktopUi.register("chat.message.action", {
        id: "action.pin",
        component: EmptyPage,
      }),
    ).toThrow("desktop UI contribution already registered");
    await ctx.fiber.dispose();
  });

  it("orders chat theme contributions so later order wins the variable merge", async () => {
    const ctx = new Context();
    await ctx.plugin(DesktopUiService);
    ctx.desktopUi.register("chat.theme", {
      id: "theme.later",
      order: 20,
      className: "theme-later",
      variables: { "--chat-text-size": "16px" },
    });
    ctx.desktopUi.register("chat.theme", {
      id: "theme.earlier",
      order: 10,
      variables: { "--chat-text-size": "13px", "--chat-message-radius": "8px" },
    });

    const snapshot = ctx.desktopUi.getSnapshot("chat.theme");
    expect(snapshot.map((item) => item.id)).toEqual(["theme.earlier", "theme.later"]);
    const merged: Record<string, string> = {};
    for (const { variables } of snapshot) Object.assign(merged, variables);
    expect(merged).toEqual({ "--chat-text-size": "16px", "--chat-message-radius": "8px" });
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
      manifest: manifest("test.public-api", [
        "sidebar.navigation",
        "route",
        "settings.page",
        "workspace.tab",
        "action",
        "shell.overlay",
        "sidebar.footer",
        "chat.header.action",
        "chat.composer.tool",
        "chat.messages.before",
        "chat.messages.after",
        "chat.messages.empty",
        "chat.composer.float",
        "chat.message.action",
        "chat.message.before",
        "chat.message.after",
        "chat.message.meta",
        "chat.generating",
        "chat.status",
        "chat.theme",
      ]),
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
            ctx.desktopUi.register("chat.messages.before", {
              id: "plugin.chat-messages-before",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.messages.after", {
              id: "plugin.chat-messages-after",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.composer.float", {
              id: "plugin.chat-composer-float",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.message.action", {
              id: "plugin.chat-message-action",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.messages.empty", {
              id: "plugin.chat-messages-empty",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.message.before", {
              id: "plugin.chat-message-before",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.message.after", {
              id: "plugin.chat-message-after",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.message.meta", {
              id: "plugin.chat-message-meta",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.generating", {
              id: "plugin.chat-generating",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.status", {
              id: "plugin.chat-status",
              component: EmptyPage,
            }),
            ctx.desktopUi.register("chat.theme", {
              id: "plugin.chat-theme",
              variables: { "--chat-message-radius": "10px" },
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
    expect(runtime.service.getSnapshot("chat.messages.before").map((item) => item.id)).toEqual([
      "plugin.chat-messages-before",
    ]);
    expect(runtime.service.getSnapshot("chat.messages.after").map((item) => item.id)).toEqual([
      "plugin.chat-messages-after",
    ]);
    expect(runtime.service.getSnapshot("chat.composer.float").map((item) => item.id)).toEqual([
      "plugin.chat-composer-float",
    ]);
    expect(runtime.service.getSnapshot("chat.message.action").map((item) => item.id)).toEqual([
      "plugin.chat-message-action",
    ]);
    expect(runtime.service.getSnapshot("chat.messages.empty").map((item) => item.id)).toEqual([
      "plugin.chat-messages-empty",
    ]);
    expect(runtime.service.getSnapshot("chat.message.before").map((item) => item.id)).toEqual([
      "plugin.chat-message-before",
    ]);
    expect(runtime.service.getSnapshot("chat.message.after").map((item) => item.id)).toEqual([
      "plugin.chat-message-after",
    ]);
    expect(runtime.service.getSnapshot("chat.message.meta").map((item) => item.id)).toEqual([
      "plugin.chat-message-meta",
    ]);
    expect(runtime.service.getSnapshot("chat.generating").map((item) => item.id)).toEqual([
      "plugin.chat-generating",
    ]);
    expect(runtime.service.getSnapshot("chat.status").map((item) => item.id)).toEqual([
      "plugin.chat-status",
    ]);
    expect(runtime.service.getSnapshot("chat.theme").map((item) => item.id)).toEqual([
      "plugin.chat-theme",
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
    expect(await runtime.uninstallPlugin(plugin.manifest.id)).toBe(true);
    expect(runtime.service.getSnapshot("route").some((item) => item.id === "plugin.route")).toBe(
      false,
    );
    expect(runtime.service.getSnapshot("action")).toEqual([]);
    expect(runtime.service.getSnapshot("shell.overlay")).toEqual([]);
    expect(runtime.service.getSnapshot("sidebar.footer")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.header.action")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.composer.tool")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.messages.before")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.messages.after")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.composer.float")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.message.action")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.messages.empty")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.message.before")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.message.after")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.message.meta")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.generating")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.status")).toEqual([]);
    expect(runtime.service.getSnapshot("chat.theme")).toEqual([]);
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
        manifest: manifest("test.custom-workspace-tab", ["workspace.tab"]),
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
      manifest: manifest("test.failing"),
      apply() {
        throw new Error("plugin exploded");
      },
    };
    const healthy: DesktopPluginModule = {
      manifest: manifest("test.healthy", ["sidebar.navigation"]),
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
      id: "test.failing",
    });
    expect(runtime.pluginResults[runtime.pluginResults.length - 1]).toMatchObject({
      ok: true,
      id: "test.healthy",
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
      manifest: manifest("test.colliding-contribution", ["sidebar.navigation"]),
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

  it("validates manifests before executing a plugin", async () => {
    const apply = vi.fn();
    const runtime = await createDesktopUiRuntime("standard", [
      {
        manifest: { ...manifest("test.bad-version"), version: "1.0" },
        apply,
      } as unknown as DesktopPluginModule,
      {
        manifest: { ...manifest("test.bad-api"), apiVersion: 2 },
        apply,
      } as unknown as DesktopPluginModule,
      {
        manifest: { ...manifest("test.bad-permission"), permissions: ["filesystem"] },
        apply,
      } as unknown as DesktopPluginModule,
      {
        manifest: { ...manifest("test.duplicate-slot"), contributes: ["route", "route"] },
        apply,
      } as unknown as DesktopPluginModule,
      {
        manifest: { ...manifest(""), id: "" },
        apply,
      } as unknown as DesktopPluginModule,
      {
        manifest: { ...manifest("test.unknown-slot"), contributes: ["unknown.slot"] },
        apply,
      } as unknown as DesktopPluginModule,
    ]);

    const failures = runtime.pluginResults.slice(-6);
    expect(failures.every((result) => !result.ok)).toBe(true);
    expect(apply).not.toHaveBeenCalled();
    expect(failures.map((result) => (result.ok ? "" : result.error.message))).toEqual([
      "desktop plugin manifest version is invalid: 1.0",
      "desktop plugin API version 2 is not supported; expected 1",
      "desktop plugin manifest permissions must be an empty array",
      "desktop plugin manifest contributes contains duplicates",
      "desktop plugin manifest id must not be empty",
      "desktop plugin manifest contributes contains an unknown slot",
    ]);
    await runtime.dispose();
  });
});
