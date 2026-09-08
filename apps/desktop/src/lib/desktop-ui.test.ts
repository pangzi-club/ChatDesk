import { Context } from "cordis";
import { MessageCircle } from "lucide-react";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  createDesktopUiRuntime,
  DesktopUiService,
  useDesktopUiSlot,
  type WorkspaceTabScope,
} from "@/lib/desktop-ui";

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
});
