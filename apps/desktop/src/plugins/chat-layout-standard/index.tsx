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
  contributes: ["chat.layout"],
  permissions: [],
} as const;
export const inject: DesktopPluginModule["inject"] = ["desktopUi", "chatLayouts"];

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      (() => {
        const disposeSlot = ctx.desktopUi.register("chat.layout", {
          id: "standard",
          label: "标准",
          component: ({ children }: ChatLayoutProps) => (
            <div className="chat-layout-root chat-layout-standard">{children}</div>
          ),
        });
        const disposeLayout = ctx.chatLayouts.register("standard", ({ children }) => (
          <div className="chat-layout-root chat-layout-standard">{children}</div>
        ));
        return () => {
          disposeSlot();
          disposeLayout();
        };
      })(),
    "standard chat layout",
  );
}
