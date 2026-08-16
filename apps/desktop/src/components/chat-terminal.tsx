import "@xterm/xterm/css/xterm.css";

import { Eraser, LoaderCircle, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { type TerminalSessionStatus, terminalSessions, terminalSupported } from "@/lib/terminal";

function pathBasename(path: string) {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() ?? path
  );
}

function shellBasename(path: string) {
  return path.split(/[\\/]/).pop() ?? path;
}

function statusLabel(status: TerminalSessionStatus) {
  if (status.phase === "starting") return "正在启动";
  if (status.phase === "running") return shellBasename(status.shell);
  if (status.phase === "exited") {
    return status.signal ? `已退出 · ${status.signal}` : `已退出 · ${status.code}`;
  }
  return "连接失败";
}

export function ChatTerminal({ cwd, sessionKey }: { cwd: string; sessionKey: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef<ReturnType<typeof terminalSessions.mount> | null>(null);
  const [status, setStatus] = useState<TerminalSessionStatus>({ phase: "starting" });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !terminalSupported()) return;
    const mounted = terminalSessions.mount(sessionKey, cwd, container, setStatus);
    mountedRef.current = mounted;
    let resizeFrame = 0;
    const scheduleFit = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => mounted.fit());
    };
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(container);
    const themeObserver = new MutationObserver(() => {
      terminalSessions.updateTheme(sessionKey);
      scheduleFit();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    resizeFrame = requestAnimationFrame(() => {
      mounted.fit();
      mounted.focus();
    });

    return () => {
      mountedRef.current = null;
      mounted.detach();
      resizeObserver.disconnect();
      themeObserver.disconnect();
      cancelAnimationFrame(resizeFrame);
    };
  }, [cwd, sessionKey]);

  if (!terminalSupported()) {
    return (
      <div className="chat-terminal-unavailable">
        <SquareTerminal className="size-5" />
        <span>Terminal 仅在桌面应用中可用</span>
      </div>
    );
  }

  return (
    <div className="chat-terminal-shell">
      <header className="chat-terminal-toolbar">
        <span className="chat-terminal-location" title={cwd}>
          <SquareTerminal className="size-3.5" />
          {pathBasename(cwd)}
        </span>
        <span className={`chat-terminal-status is-${status.phase}`} title={statusLabel(status)}>
          {status.phase === "starting" ? (
            <LoaderCircle className="size-3 animate-spin" />
          ) : (
            <span className="chat-terminal-status-dot" />
          )}
          {statusLabel(status)}
        </span>
        <Button
          aria-label="清空 Terminal"
          className="chat-workspace-window-add"
          onClick={() => mountedRef.current?.clear()}
          size="icon"
          title="清空"
          type="button"
          variant="ghost"
        >
          <Eraser className="size-4" />
        </Button>
      </header>
      {status.phase === "error" ? (
        <div className="chat-terminal-error" role="alert">
          {status.message}
        </div>
      ) : null}
      <div className="chat-terminal" ref={containerRef} />
    </div>
  );
}
