import type { Context } from "cordis";
import type { ChatLayoutProps } from "@/lib/chat-layout";

export const name = "chat-layout-standard";
export const inject = ["chatLayouts"];

export function apply(ctx: Context) {
  return ctx.chatLayouts.register("standard", ({ children }: ChatLayoutProps) => (
    <div className="chat-layout-root chat-layout-standard">{children}</div>
  ));
}
