import type { DesktopPluginModule } from "@chatdesk/desktop-plugin-sdk";
import type { Context } from "cordis";
import type { ChatLayoutProps } from "@/lib/chat-layout";

export const manifest = {
  id: "chat-layout-standard",
  builtin: true,
  name: "标准聊天布局",
  description: "提供简洁稳定的默认 Chat 页面布局。",
  version: "1.0.0",
  apiVersion: 1,
  entry: "plugins/chat-layout-standard",
  contributes: [],
  permissions: [],
} as const;
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
