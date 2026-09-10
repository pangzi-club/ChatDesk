import type { DesktopPluginModule } from "@chatdesk/desktop-plugin-sdk";
import type { Context } from "cordis";
import { Cloud, Fish, Sparkles, Waves } from "lucide-react";
import type { ChatLayoutProps } from "@/lib/chat-layout";

export const manifest = {
  id: "chat-layout-cute",
  builtin: true,
  name: "可爱聊天布局",
  description: "为 Chat 页面提供轻松活泼的海洋主题布局。",
  version: "1.0.0",
  apiVersion: 1,
  entry: "plugins/chat-layout-cute",
  contributes: ["chat.layout"],
  permissions: [],
} as const;
export const inject: DesktopPluginModule["inject"] = ["desktopUi", "chatLayouts"];

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      (() => {
        const component = ({ children }: ChatLayoutProps) => (
          <div className="chat-layout-root chat-layout-cute">
            <div aria-hidden="true" className="chat-cute-scenery">
              <Cloud className="chat-cute-cloud is-one" />
              <Cloud className="chat-cute-cloud is-two" />
              <Cloud className="chat-cute-cloud is-three" />
              <Fish className="chat-cute-fish is-one" />
              <Fish className="chat-cute-fish is-two" />
              <Fish className="chat-cute-fish is-three" />
              <Sparkles className="chat-cute-sparkle is-one" />
              <Sparkles className="chat-cute-sparkle is-two" />
              <Waves className="chat-cute-waves" />
            </div>
            {children}
          </div>
        );
        const disposeSlot = ctx.desktopUi.register("chat.layout", {
          id: "cute",
          label: "可爱",
          component,
        });
        const disposeLayout = ctx.chatLayouts.register("cute", component);
        return () => {
          disposeSlot();
          disposeLayout();
        };
      })(),
    "cute chat layout",
  );
}
