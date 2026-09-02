import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { ChatLayoutService, createChatLayoutRuntime } from "@/lib/chat-layout";

describe("ChatLayoutService", () => {
  it("registers, activates, notifies, and disposes layouts", async () => {
    const ctx = new Context();
    await ctx.plugin(ChatLayoutService);
    const service = ctx.chatLayouts;
    const listener = vi.fn();
    const standard = () => null;
    const cute = () => null;
    const disposeStandard = service.register("standard", standard);
    const disposeCute = service.register("cute", cute);
    const unsubscribe = service.subscribe(listener);

    expect(service.getSnapshot()).toMatchObject({ id: "standard", component: standard });
    service.activate("cute");
    expect(service.getSnapshot()).toMatchObject({ id: "cute", component: cute });
    expect(listener).toHaveBeenCalledOnce();
    expect(() => service.activate("geek")).toThrow("unknown chat layout");

    disposeCute();
    expect(service.getSnapshot()).toMatchObject({ id: "standard", component: standard });
    unsubscribe();
    disposeStandard();
    await ctx.fiber.dispose();
  });

  it("boots the bundled layout runtime", async () => {
    const runtime = await createChatLayoutRuntime("geek");
    expect(runtime.service.getSnapshot().id).toBe("geek");
    expect(runtime.service.getSnapshot().component).toBeTypeOf("function");
    await runtime.dispose();
  });
});
