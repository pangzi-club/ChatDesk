import { getCurrentWindow } from "@tauri-apps/api/window";
import { ChartColumn, LayoutDashboard, Lock, Monitor, PanelLeft, Settings } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import { TitlebarDragRegion, TrafficLights } from "@/components/titlebar";
import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/analytics", label: "Analytics", icon: ChartColumn },
  { to: "/encrypt", label: "Encrypt", icon: Lock },
  { to: "/settings", label: "Settings", icon: Settings },
] satisfies Array<{
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}>;

function AppShell() {
  const [maximized, setMaximized] = useState(false);

  // 最大化/全屏时去掉圆角和描边，恢复正常矩形窗口
  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;

    win.isMaximized().then(setMaximized);
    win
      .onResized(() => {
        win.isMaximized().then(setMaximized);
      })
      .then((fn) => {
        unlisten = fn;
      });

    return () => unlisten?.();
  }, []);

  return (
    <main
      className={`flex h-screen flex-col overflow-hidden bg-background text-foreground ${
        maximized ? "" : "rounded-[10px] ring-1 ring-black/10 dark:ring-border"
      }`}
    >
      <div className="flex min-h-0 w-full flex-1 overflow-hidden bg-background">
        {/* 左列：红绿灯 + 侧栏同一背景，连成一体 */}
        <aside className="flex w-[280px] shrink-0 flex-col border-border border-r bg-card max-md:w-[72px] max-sm:w-16">
          <div className="flex h-10 shrink-0 items-center select-none">
            <TrafficLights />
            <TitlebarDragRegion />
          </div>
          <SidebarHeader />
          <nav
            className="space-y-1 px-3 py-2 max-md:px-2 max-sm:px-1.5"
            aria-label="Main navigation"
          >
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  className={({ isActive }) =>
                    `flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-background text-foreground shadow-xs ring-1 ring-border"
                        : "text-muted-foreground hover:bg-background/70 hover:text-foreground"
                    } max-md:justify-center max-md:px-0 max-sm:h-8`
                  }
                  key={item.to}
                  to={item.to}
                >
                  <Icon className="size-4 shrink-0" />
                  <span className="max-md:hidden">{item.label}</span>
                </NavLink>
              );
            })}
          </nav>

          <div className="min-h-0 flex-1" />

          <footer className="mt-auto flex h-12 items-center justify-between border-border border-t px-3 max-md:justify-center max-md:px-0">
            <div className="flex min-w-0 items-center gap-2">
              <Settings className="size-4 shrink-0 text-muted-foreground" />
              <span className="truncate font-semibold text-sm text-muted-foreground max-md:hidden">
                OpenAI
              </span>
            </div>
          </footer>
        </aside>

        {/* 右列：内容区铺满到窗口顶部，拖拽条透明浮在上方 */}
        <div className="relative flex min-w-0 flex-1 flex-col bg-background max-sm:w-[calc(100vw-4rem)]">
          <section className="min-h-0 flex-1 overflow-y-auto">
            <Outlet />
          </section>
          <div className="absolute inset-x-0 top-0 z-10 flex h-10 items-center">
            <TitlebarDragRegion />
            <TopActions />
          </div>
        </div>
      </div>
    </main>
  );
}

function SidebarHeader() {
  return (
    <header className="flex items-center justify-between px-3 pt-4 pb-3 max-md:justify-center max-md:px-2 max-sm:px-1.5">
      <h1 className="truncate font-semibold text-base text-muted-foreground max-md:hidden">
        m-dashboard
      </h1>
      <Button
        aria-label="Collapse sidebar"
        className="size-8 text-muted-foreground max-md:hidden"
        size="icon"
        type="button"
        variant="ghost"
      >
        <PanelLeft className="size-4" />
      </Button>
    </header>
  );
}

function TopActions() {
  return (
    <div className="flex items-center gap-1.5 px-3 text-muted-foreground max-sm:gap-0.5 max-sm:px-2">
      <Button
        aria-label="Minimize panel"
        className="size-8"
        size="icon"
        type="button"
        variant="ghost"
      >
        <Monitor className="size-4" />
      </Button>
      <Button
        aria-label="Toggle panel"
        className="size-8"
        size="icon"
        type="button"
        variant="ghost"
      >
        <PanelLeft className="size-4 rotate-180" />
      </Button>
    </div>
  );
}

export { AppShell };
