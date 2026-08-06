import { ArrowLeft, FolderGit2, Lock, SquareTerminal, TextCursorInput, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";

const tools = [
  { to: "/dev-tools/encrypt", label: "Encrypt", icon: Lock },
  { to: "/dev-tools/vite-ports", label: "VitePorts", icon: SquareTerminal },
  { to: "/dev-tools/inputs", label: "Inputs", icon: TextCursorInput },
  { to: "/dev-tools/workspaces", label: "Workspaces", icon: FolderGit2 },
] satisfies Array<{
  to: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}>;

function DevToolsLayout() {
  const navigate = useNavigate();

  return (
    <div className="flex min-h-full w-full bg-background">
      <aside className="sticky top-0 flex h-screen w-[272px] shrink-0 flex-col border-border border-r bg-card/80 px-4 pt-10 max-md:w-[220px] max-sm:w-[76px] max-sm:px-2">
        <Button
          aria-label="返回应用"
          className="mb-5 justify-start gap-2 px-2 text-muted-foreground hover:text-foreground max-sm:justify-center max-sm:px-0"
          onClick={() => navigate("/dashboard")}
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="size-4" />
          <span className="max-sm:hidden">返回应用</span>
        </Button>
        <div className="mb-7 flex h-10 items-center gap-2 rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-xs">
          <Wrench className="size-4 shrink-0 text-muted-foreground" />
          <span className="font-medium max-sm:hidden">Dev Tools</span>
        </div>
        <p className="px-2 pb-2 font-medium text-muted-foreground text-xs uppercase tracking-wider max-sm:hidden">
          工具
        </p>
        <nav className="space-y-1" aria-label="开发工具导航">
          {tools.map((tool) => (
            <DevToolsNavItem key={tool.to} {...tool} />
          ))}
        </nav>
        <div className="mt-auto border-border border-t py-5 text-muted-foreground text-xs max-sm:hidden">
          m-dashboard
          <span className="mt-1 block opacity-60">本地开发工具</span>
        </div>
      </aside>
      <main className="flex min-h-full min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}

function DevToolsNavItem({
  to,
  icon: Icon,
  label,
}: {
  to: string;
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <NavLink
      className={({ isActive }) =>
        `flex h-10 items-center gap-3 rounded-md px-3 text-sm transition-colors max-sm:justify-center max-sm:px-0 ${isActive ? "bg-accent text-accent-foreground font-medium" : "text-muted-foreground hover:bg-accent/70 hover:text-foreground"}`
      }
      to={to}
    >
      <Icon className="size-4" />
      <span className="max-sm:hidden">{label}</span>
    </NavLink>
  );
}

export { DevToolsLayout };
