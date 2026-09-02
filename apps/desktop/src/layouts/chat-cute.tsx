import type { Context } from "cordis";
import { Cloud, Fish, Sparkles, Waves } from "lucide-react";
import type { ChatLayoutProps } from "@/lib/chat-layout";

export const name = "chat-layout-cute";
export const inject = ["chatLayouts"];

export function apply(ctx: Context) {
  return ctx.chatLayouts.register("cute", ({ children }: ChatLayoutProps) => (
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
  ));
}
