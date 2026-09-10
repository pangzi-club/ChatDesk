import type { DesktopPluginModule } from "@chatdesk/desktop-plugin-sdk";
import type { Context } from "cordis";
import type { ChatLayoutProps } from "@/lib/chat-layout";

export const manifest = {
  id: "chat-layout-geek",
  builtin: true,
  name: "Geek 聊天布局",
  description: "为 Chat 页面提供偏开发者风格的代码主题布局。",
  version: "1.0.0",
  apiVersion: 1,
  entry: "plugins/chat-layout-geek",
  contributes: ["chat.layout"],
  permissions: [],
} as const;
export const inject: DesktopPluginModule["inject"] = ["desktopUi", "chatLayouts"];

const glyphs = [
  { id: "binary-a", text: "01" },
  { id: "braces", text: "{}" },
  { id: "arrow", text: "=>" },
  { id: "comment", text: "//" },
  { id: "tag", text: "</>" },
  { id: "prompt", text: "$" },
  { id: "brackets", text: "[]" },
  { id: "and", text: "&&" },
  { id: "scope", text: "::" },
  { id: "binary-b", text: "10" },
] as const;

export function apply(ctx: Context) {
  ctx.effect(
    () =>
      (() => {
        const component = ({ children }: ChatLayoutProps) => (
          <div className="chat-layout-root chat-layout-geek">
            <div aria-hidden="true" className="chat-geek-streams">
              {glyphs.map((glyph, index) => (
                <span className={`chat-geek-glyph is-${index + 1}`} key={glyph.id}>
                  {glyph.text}
                </span>
              ))}
            </div>
            {children}
          </div>
        );
        const disposeSlot = ctx.desktopUi.register("chat.layout", {
          id: "geek",
          label: "Geek",
          component,
        });
        const disposeLayout = ctx.chatLayouts.register("geek", component);
        return () => {
          disposeSlot();
          disposeLayout();
        };
      })(),
    "geek chat layout",
  );
}
