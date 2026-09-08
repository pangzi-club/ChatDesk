import { MoreHorizontal, Package, Search, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDesktopUi } from "@/lib/desktop-ui";
import { getPluginCategory, getPluginIcon, getPluginSearchText } from "@/lib/plugin-catalog";

type PluginFilter = "all" | "installed";

export function PluginsPage() {
  const runtime = useDesktopUi();
  const navigate = useNavigate();
  const [, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<PluginFilter>("all");
  const plugins = runtime.scanPlugins();
  const installed = plugins.filter((plugin) => plugin.installed && plugin.manifest);
  const filteredPlugins = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return plugins.filter((plugin) => {
      if (filter === "installed" && !plugin.installed) return false;
      return !normalized || getPluginSearchText(plugin).includes(normalized);
    });
  }, [filter, plugins, query]);
  const groups = useMemo(() => {
    const grouped = new Map<string, typeof filteredPlugins>();
    for (const plugin of filteredPlugins) {
      const category = getPluginCategory(plugin);
      grouped.set(category, [...(grouped.get(category) ?? []), plugin]);
    }
    const categoryOrder = ["精选", "聊天与工作流", "工作区", "生产力", "内置"];
    return [...grouped.entries()].sort(
      ([a], [b]) =>
        (categoryOrder.indexOf(a) < 0 ? categoryOrder.length : categoryOrder.indexOf(a)) -
        (categoryOrder.indexOf(b) < 0 ? categoryOrder.length : categoryOrder.indexOf(b)),
    );
  }, [filteredPlugins]);

  async function toggle(id: string, isInstalled: boolean) {
    setBusy(id);
    setError(null);
    try {
      if (isInstalled) await runtime.uninstallPlugin(id);
      else {
        const result = await runtime.installDiscoveredPlugin(id);
        if (!result.ok) throw result.error;
      }
      setRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-background px-6 py-8 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-5xl">
        <header className="mb-8">
          <div className="flex items-center gap-3">
            <Package className="size-5 text-muted-foreground" />
            <div>
              <h1 className="font-semibold text-2xl tracking-tight">插件</h1>
              <p className="mt-1 text-muted-foreground text-sm">在你常用的工具中使用 ChatDesk</p>
            </div>
          </div>
          <label
            className="mt-6 flex h-10 items-center gap-2 rounded-full border border-input bg-muted/40 px-4 text-muted-foreground"
            htmlFor="plugin-search"
          >
            <Search className="size-4 shrink-0" />
            <Input
              aria-label="搜索插件"
              className="h-auto border-0 bg-transparent p-0 shadow-none focus-visible:ring-0"
              id="plugin-search"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索插件"
              value={query}
            />
          </label>
        </header>

        {error ? (
          <div className="mb-6 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
            <TriangleAlert className="size-4" />
            {error}
          </div>
        ) : null}

        <section className="mb-8 border-b pb-7">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-lg">已安装</h2>
            <span className="text-muted-foreground text-xs">{installed.length} 个插件</span>
          </div>
          {installed.length ? (
            <div className="flex flex-wrap gap-3">
              {installed.map((plugin) => {
                const Icon = getPluginIcon(plugin);
                const id = plugin.manifest?.id ?? plugin.entry;
                return (
                  <button
                    aria-label={`查看 ${plugin.manifest?.name ?? id}`}
                    className="flex size-14 items-center justify-center rounded-xl border bg-card text-foreground shadow-xs transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    key={id}
                    onClick={() => navigate(`/plugins/${encodeURIComponent(id)}`)}
                    title={plugin.manifest?.name ?? id}
                    type="button"
                  >
                    <Icon className="size-6 text-primary" />
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">还没有安装插件。</p>
          )}
        </section>

        <Tabs onValueChange={(value) => setFilter(value as PluginFilter)} value={filter}>
          <TabsList aria-label="插件筛选" variant="line" className="mb-8">
            <TabsTrigger value="all">全部</TabsTrigger>
            <TabsTrigger value="installed">已安装</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="space-y-10 pb-12">
          {groups.length ? (
            groups.map(([category, items]) => (
              <section key={category}>
                <div className="mb-3 flex items-center justify-between border-b pb-3">
                  <h2 className="font-semibold text-lg">{category}</h2>
                  <span className="text-muted-foreground text-xs">{items.length}</span>
                </div>
                <div className="grid gap-x-10 md:grid-cols-2">
                  {items.map((plugin) => {
                    const manifest = plugin.manifest;
                    const id = manifest?.id ?? plugin.entry;
                    const Icon = getPluginIcon(plugin);
                    return (
                      <div className="flex min-w-0 items-center gap-3 border-b py-4" key={id}>
                        <button
                          aria-label={`查看 ${manifest?.name ?? id}`}
                          className="flex size-11 shrink-0 items-center justify-center rounded-xl border bg-card text-primary transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() => navigate(`/plugins/${encodeURIComponent(id)}`)}
                          type="button"
                        >
                          <Icon className="size-5" />
                        </button>
                        <button
                          className="min-w-0 flex-1 text-left focus-visible:outline-none"
                          onClick={() => navigate(`/plugins/${encodeURIComponent(id)}`)}
                          type="button"
                        >
                          <span className="block truncate font-medium">
                            {manifest?.name ?? manifest?.id ?? "未知插件"}
                          </span>
                          <span className="mt-1 block truncate text-muted-foreground text-sm">
                            {manifest?.description ?? "没有提供描述"}
                          </span>
                          <span className="mt-1 block truncate text-muted-foreground text-xs">
                            v{manifest?.version ?? "-"} ·{" "}
                            {manifest?.contributes?.join(", ") || "无贡献"}
                          </span>
                        </button>
                        <div className="flex shrink-0 items-center gap-1">
                          <Badge
                            variant={
                              manifest?.builtin
                                ? "outline"
                                : plugin.installed
                                  ? "default"
                                  : "secondary"
                            }
                          >
                            {manifest?.builtin
                              ? "内置"
                              : plugin.installed
                                ? "已安装"
                                : plugin.installable
                                  ? "可安装"
                                  : "不可用"}
                          </Badge>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button aria-label="更多操作" size="icon" variant="ghost">
                                <MoreHorizontal className="size-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem
                                onClick={() => navigate(`/plugins/${encodeURIComponent(id)}`)}
                              >
                                查看详情
                              </DropdownMenuItem>
                              {plugin.installable && manifest && !manifest.builtin ? (
                                <DropdownMenuItem
                                  disabled={busy === manifest.id}
                                  onClick={() => void toggle(manifest.id, plugin.installed)}
                                >
                                  {plugin.installed ? "卸载" : "安装"}
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))
          ) : (
            <div className="py-16 text-center text-muted-foreground text-sm">没有匹配的插件。</div>
          )}
        </div>
      </div>
    </main>
  );
}
