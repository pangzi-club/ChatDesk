import { Context } from "cordis";
import { MessageCircle } from "lucide-react";
import { describe, expect, it, vi } from "vitest";
import { createDesktopUiRuntime, DesktopUiService } from "@/lib/desktop-ui";

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

  it("boots all bundled contributions in the shared runtime", async () => {
    const runtime = await createDesktopUiRuntime("geek");
    const navigation = runtime.service.getSnapshot("sidebar.navigation");
    const settings = runtime.service.getSnapshot("settings.page");

    expect(navigation.map((item) => item.id)).toEqual(["chat", "channels", "automations"]);
    expect(settings.length).toBeGreaterThan(0);
    expect(new Set(settings.map((item) => item.id)).size).toBe(settings.length);
    expect(new Set(settings.map((item) => item.path)).size).toBe(settings.length);
    expect(settings.every((item) => item.label && item.keywords.length > 0)).toBe(true);
    expect(runtime.chatLayouts.getSnapshot().id).toBe("geek");

    await runtime.dispose();
    expect(runtime.service.getSnapshot("sidebar.navigation")).toEqual([]);
    expect(runtime.service.getSnapshot("settings.page")).toEqual([]);
  });
});
