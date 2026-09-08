import type { Context } from "cordis";
import type { ChatLayoutProps } from "@/lib/chat-layout";
import type { DesktopPluginModule } from "@/plugin-api";

export const name = "chat-layout-standard";
export const inject: DesktopPluginModule["inject"] = ["chatLayouts"];

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      ctx.chatLayouts.register("standard", ({ children }: ChatLayoutProps) => (
        <div className="chat-layout-root chat-layout-standard">{children}</div>
      )),
    "standard chat layout",
  );
}
