import { LayoutDashboard, Monitor, PanelLeft, Settings } from "lucide-react";
import type { ComponentType } from "react";
import { NavLink, Outlet } from "react-router-dom";

import { Button } from "@/components/ui/button";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/settings", label: "Settings", icon: Settings },
] satisfies Array<{
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}>;

function AppShell() {
  return (
    <main className="min-h-screen overflow-hidden bg-white text-zinc-950">
      <div className="flex min-h-screen w-full overflow-hidden bg-white">
        <aside className="flex w-[272px] shrink-0 flex-col border-zinc-200 border-r bg-zinc-50/95 max-md:w-[88px] max-sm:w-16">
          <SidebarHeader />
          <nav className="space-y-1 px-4 py-3 max-md:px-3 max-sm:px-2" aria-label="Main navigation">
            {navItems.map((item) => {
              const Icon = item.icon;

              return (
                <NavLink
                  className={({ isActive }) =>
                    `flex h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-white text-zinc-950 shadow-xs ring-1 ring-zinc-200"
                        : "text-zinc-600 hover:bg-white/70 hover:text-zinc-950"
                    } max-md:justify-center max-md:px-0 max-sm:h-9`
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

          <footer className="mt-auto flex h-14 items-center justify-between border-zinc-200 border-t px-4 max-md:justify-center max-md:px-0">
            <div className="flex min-w-0 items-center gap-2">
              <Settings className="size-4 shrink-0 text-zinc-600" />
              <span className="truncate font-semibold text-sm text-zinc-700 max-md:hidden">
                OpenAI
              </span>
            </div>
          </footer>
        </aside>

        <section className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-white max-sm:w-[calc(100vw-4rem)]">
          <TopActions />
          <Outlet />
        </section>
      </div>
    </main>
  );
}

function SidebarHeader() {
  return (
    <header className="flex items-center justify-between px-4 pt-6 pb-5 max-md:justify-center max-md:px-3 max-sm:px-2">
      <h1 className="truncate font-semibold text-lg text-zinc-700 max-md:hidden">m-dashboard</h1>
      <Button
        aria-label="Collapse sidebar"
        className="size-8 text-zinc-400 max-md:hidden"
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
    <div className="absolute top-5 right-5 z-10 flex items-center gap-3 text-zinc-400 max-sm:right-3 max-sm:gap-1">
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
