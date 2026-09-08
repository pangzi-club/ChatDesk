import { ArrowLeft, Search } from "lucide-react";
import { useState } from "react";
import {
  NavLink,
  type NavLinkRenderProps,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Button } from "@/components/ui/button";
import { getReturnPath } from "@/lib/app-return-path";
import { useDesktopUiSlot } from "@/lib/desktop-ui";

export function SettingsLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState("");
  const pages = useDesktopUiSlot("settings.page");
  const isHistoryRoute = location.pathname.startsWith("/settings/history");
  const activePage = pages.find((page) => `/settings/${page.path}` === location.pathname);
  const useFullLayout = isHistoryRoute || activePage?.layout === "full";
  const normalizedSearch = search.trim().toLocaleLowerCase();
  const visiblePages = pages.filter(
    (page) =>
      page.visible !== false &&
      (!normalizedSearch ||
        [page.label, ...page.keywords].some((value) =>
          value.toLocaleLowerCase().includes(normalizedSearch),
        )),
  );

  return (
    <div
      className={`settings-page ${useFullLayout ? "flex h-full min-h-0 w-full overflow-hidden bg-background" : "flex min-h-full w-full bg-background"}`}
    >
      <aside className="app-shell-sidebar sticky top-0 flex h-screen w-[248px] shrink-0 flex-col border-border border-r px-4 pt-8 max-md:w-[220px] max-sm:w-[76px] max-sm:px-2">
        <Button
          aria-label="返回应用"
          className="mb-3 h-8 justify-start gap-2 px-2 text-muted-foreground text-sm hover:text-foreground max-sm:justify-center max-sm:px-0"
          onClick={() => navigate(getReturnPath())}
          type="button"
          variant="ghost"
        >
          <ArrowLeft className="size-4" />
          <span className="max-sm:hidden">返回应用</span>
        </Button>
        <label className="mb-4 flex h-8 items-center gap-2 rounded-md border border-border bg-background px-3 text-[13px] text-muted-foreground shadow-xs">
          <Search className="size-4 shrink-0" />
          <input
            aria-label="搜索设置"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground max-sm:hidden"
            onChange={(event) => setSearch(event.target.value)}
            placeholder="搜索设置..."
            value={search}
          />
        </label>
        <p className="px-2 pb-1 font-medium text-[11px] text-muted-foreground uppercase tracking-wider max-sm:hidden">
          工作区
        </p>
        <nav className="min-h-0 flex-1 space-y-0.5 overflow-y-auto" aria-label="设置导航">
          {visiblePages.map((page) => {
            const Icon = page.icon;
            return (
              <NavLink
                className={({ isActive }: NavLinkRenderProps) =>
                  `sidebar-nav-item flex h-8 items-center gap-2 px-3 text-[13px] transition-colors max-sm:justify-center max-sm:px-0 ${isActive ? "is-active font-medium" : ""}`
                }
                key={page.id}
                to={`/settings/${page.path}`}
              >
                <Icon className="size-4" />
                <span className="max-sm:hidden">{page.label}</span>
              </NavLink>
            );
          })}
        </nav>
        <div className="mt-3 border-border border-t py-3 text-[11px] text-muted-foreground max-sm:hidden">
          ChatDesk<span className="mt-1 block opacity-60">本地工作区设置</span>
        </div>
      </aside>
      {useFullLayout ? (
        <main className="app-shell-content flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </main>
      ) : (
        <main className="app-shell-content min-w-0 flex-1 px-8 pt-16 pb-14 sm:px-12 lg:px-20">
          <div className="mx-auto w-full max-w-3xl">
            <Outlet />
          </div>
        </main>
      )}
    </div>
  );
}
