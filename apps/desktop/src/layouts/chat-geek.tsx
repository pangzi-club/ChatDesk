import type { Context } from "cordis";
import type { ChatLayoutProps } from "@/lib/chat-layout";
import type { DesktopPluginModule } from "@/plugin-api";

export const manifest = {
  id: "chat-layout-geek",
  version: "1.0.0",
  apiVersion: 1,
  entry: "layouts/chat-geek",
  contributes: [],
  permissions: [],
} as const;
export const inject: DesktopPluginModule["inject"] = ["chatLayouts"];

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
      ctx.chatLayouts.register("geek", ({ children }: ChatLayoutProps) => (
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
      )),
    "geek chat layout",
  );
}
