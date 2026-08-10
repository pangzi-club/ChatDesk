import { ArrowLeft, Lock, SquareTerminal, Wrench } from "lucide-react";
import type { ComponentType } from "react";
import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";

import { Button } from "@/components/ui/button";
import { getReturnPath } from "@/lib/app-return-path";

const tools = [
  {
    to: "/dev-tools/encrypt",
    label: "Encrypt",
    description: "使用 AES-GCM-256 在本地加密与解密文本。",
    icon: Lock,
  },
  {
    to: "/dev-tools/vite-ports",
    label: "VitePorts",
    description: "查看本机 Vite 开发服务并快速释放占用端口。",
    icon: SquareTerminal,
  },
] satisfies Array<{
  to: string;
  label: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
}>;

function DevToolsPage() {
  return (
    <div className="app-page-root flex w-full flex-1 flex-col gap-6 px-4 pt-12 pb-8 sm:px-6 lg:px-8">
      <header>
        <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
          Development
        </p>
        <h1 className="mt-2 font-semibold text-3xl tracking-tight">Dev Tools</h1>
        <p className="mt-2 max-w-2xl text-muted-foreground text-sm">
          本地开发工具集合，选择一个工具开始使用。
        </p>
      </header>

      <section aria-label="开发工具列表" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {tools.map((tool) => {
          const Icon = tool.icon;

          return (
            <Link
              className="group rounded-lg border border-border bg-card p-5 transition-colors hover:bg-accent/40"
              key={tool.to}
              to={tool.to}
            >
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors group-hover:text-foreground">
                  <Icon className="size-4" />
                </span>
                <h2 className="font-medium text-foreground">{tool.label}</h2>
              </div>
              <p className="mt-3 text-muted-foreground text-sm leading-6">{tool.description}</p>
            </Link>
          );
        })}
      </section>
    </div>
  );
}

function DevToolsLayout() {
  const navigate = useNavigate();

  return (
    <div className="app-page-root flex h-full min-h-0 w-full overflow-hidden">
      <aside className="app-shell-sidebar flex h-full w-[248px] shrink-0 flex-col overflow-y-auto border-border border-r px-4 pt-10 max-md:w-[220px] max-sm:w-[76px] max-sm:px-2">
        <Button
          aria-label="返回应用"
          className="mb-5 justify-start gap-2 px-2 text-muted-foreground hover:text-foreground max-sm:justify-center max-sm:px-0"
          onClick={() => navigate(getReturnPath())}
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
            <DevToolsNavItem key={tool.to} icon={tool.icon} label={tool.label} to={tool.to} />
          ))}
        </nav>
        <div className="mt-auto border-border border-t py-5 text-muted-foreground text-xs max-sm:hidden">
          ChatDesk
          <span className="mt-1 block opacity-60">本地开发工具</span>
        </div>
      </aside>
      <main className="app-shell-content flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
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
        `sidebar-nav-item flex h-8 items-center gap-3 px-3 text-sm transition-colors max-sm:justify-center max-sm:px-0 ${isActive ? "is-active font-medium" : ""}`
      }
      to={to}
    >
      <Icon className="size-4" />
      <span className="max-sm:hidden">{label}</span>
    </NavLink>
  );
}

export { DevToolsLayout, DevToolsPage };
