import { Fish, Terminal } from "lucide-react";
import { useChatLayoutId } from "@/lib/chat-layout";

/** Portal-safe, non-interactive ornaments for the active Chat layout. */
export function ChatLayoutThemeLayer() {
  const layout = useChatLayoutId();

  return (
    <div aria-hidden="true" className={`chat-layout-theme-layer chat-layout-theme-${layout}`}>
      {layout === "cute" ? <Fish className="chat-layout-theme-fish" /> : null}
      {layout === "geek" ? (
        <span className="chat-layout-theme-terminal">
          <Terminal className="size-3.5" />
          <span>theme://geek</span>
        </span>
      ) : null}
    </div>
  );
}
