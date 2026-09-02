import type { Context } from "cordis";
import type { ChatLayoutProps } from "@/lib/chat-layout";

export const name = "chat-layout-geek";
export const inject = ["chatLayouts"];

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
  return ctx.chatLayouts.register("geek", ({ children }: ChatLayoutProps) => (
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
  ));
}
