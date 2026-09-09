import { ArrowLeft, ExternalLink, FolderOpen, MoreHorizontal, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Switch } from "@/components/ui/switch";
import { useDesktopUi, useDesktopUiSlot } from "@/lib/desktop-ui";
import { revealExternalPluginDirectory } from "@/lib/external-plugins";
import {
  getContributionInfo,
  getPluginCategory,
  getPluginExamples,
  getPluginIcon,
} from "@/lib/plugin-catalog";

export function PluginDetailPage() {
  const runtime = useDesktopUi();
  const routes = useDesktopUiSlot("route");
  const navigate = useNavigate();
  const { pluginId = "" } = useParams();
  const id = decodeURIComponent(pluginId);
  const plugin = runtime.scanPlugins().find((item) => item.manifest?.id === id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!plugin?.manifest) {
    return (
      <main className="h-full overflow-y-auto bg-background px-6 py-8 sm:px-10 lg:px-16">
        <div className="mx-auto max-w-4xl">
          <Button onClick={() => navigate("/plugins")} variant="ghost">
            <ArrowLeft className="size-4" /> 返回插件
          </Button>
          <div className="py-20 text-center text-muted-foreground">找不到这个插件。</div>
        </div>
      </main>
    );
  }

  const manifest = plugin.manifest;
  const discoveredPlugin = plugin;
  const Icon = getPluginIcon(plugin);
  const isInstalled = plugin.installed;
  const route = routes.find((candidate) => candidate.id === manifest.id);
  const canOpen = isInstalled && route;

  async function installOrUninstall() {
    setBusy(true);
    setError(null);
    try {
      if (isInstalled) await runtime.uninstallPlugin(manifest.id);
      else {
        const result = await runtime.installDiscoveredPlugin(manifest.id);
        if (!result.ok) throw result.error;
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function revealDirectory() {
    if (!discoveredPlugin.directory) return;
    try {
      await revealExternalPluginDirectory(discoveredPlugin.directory);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <main className="h-full overflow-y-auto bg-background px-6 py-8 sm:px-10 lg:px-16">
      <div className="mx-auto max-w-4xl pb-16">
        <div className="mb-8 flex items-center justify-between">
          <Button onClick={() => navigate("/plugins")} variant="ghost">
            <ArrowLeft className="size-4" /> 返回插件
          </Button>
          {!manifest.builtin ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button aria-label="更多操作" size="icon" variant="ghost">
                  <MoreHorizontal className="size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => void installOrUninstall()}>
                  {plugin.installed ? "卸载插件" : "安装插件"}
                </DropdownMenuItem>
                {discoveredPlugin.source === "external" && discoveredPlugin.directory ? (
                  <DropdownMenuItem onClick={() => void revealDirectory()}>
                    打开插件目录
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <section className="border-b pb-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 items-start gap-4">
              <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl border bg-card text-primary shadow-xs">
                <Icon className="size-8" />
              </div>
              <div className="min-w-0">
                <h1 className="truncate font-semibold text-2xl tracking-tight">
                  {manifest.name ?? manifest.id}
                </h1>
                <p className="mt-1 text-muted-foreground">
                  {manifest.description ?? "没有提供描述"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              {canOpen ? (
                <Button onClick={() => navigate(route.path)}>
                  打开 <ExternalLink className="size-4" />
                </Button>
              ) : (
                <Button
                  disabled={
                    manifest.builtin || busy || (isInstalled && !canOpen) || !plugin.installable
                  }
                  onClick={() => void installOrUninstall()}
                >
                  {manifest.builtin
                    ? "内置插件"
                    : busy
                      ? "处理中…"
                      : isInstalled
                        ? "已安装"
                        : "安装"}
                </Button>
              )}
            </div>
          </div>
        </section>

        {error ? (
          <div className="mt-6 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
            <TriangleAlert className="size-4" /> {error}
          </div>
        ) : null}
        {plugin.errors.length ? (
          <div className="mt-6 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm">
            {plugin.errors.map((item) => (
              <p key={item.code}>{item.message}</p>
            ))}
          </div>
        ) : null}

        <section className="mt-8 overflow-hidden rounded-xl border bg-muted/30 p-5 sm:p-8">
          <div className="mx-auto max-w-2xl space-y-3">
            {getPluginExamples(plugin).map((example) => (
              <div
                className="flex items-center justify-between gap-4 rounded-xl border bg-background px-4 py-3 text-sm shadow-xs"
                key={example}
              >
                <span className="min-w-0 truncate">{example}</span>
                <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                  →
                </span>
              </div>
            ))}
          </div>
        </section>

        <p className="mt-6 text-muted-foreground text-sm leading-6">
          {manifest.description ?? "这个本地插件为 ChatDesk 提供额外的工作能力。"}
        </p>

        <section className="mt-10">
          <div className="mb-3 flex items-center gap-2 border-b pb-3">
            <h2 className="font-semibold text-lg">能力</h2>
            <span className="text-muted-foreground text-sm">{manifest.contributes.length}</span>
          </div>
          <div className="divide-y">
            {manifest.contributes.map((slot) => {
              const info = getContributionInfo(slot);
              return (
                <div className="flex items-center gap-3 py-4" key={slot}>
                  <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card text-primary text-xs">
                    {info.label.slice(0, 1)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-sm">{info.label}</p>
                    <p className="mt-1 truncate text-muted-foreground text-sm">
                      {info.description}
                    </p>
                  </div>
                  <Switch aria-label={`${info.label} 已启用`} checked={isInstalled} disabled />
                </div>
              );
            })}
          </div>
        </section>

        <section className="mt-10">
          <h2 className="mb-3 border-b pb-3 font-semibold text-lg">信息</h2>
          <dl className="grid grid-cols-[110px_1fr] gap-x-6 gap-y-3 text-sm">
            <dt className="text-muted-foreground">类别</dt>
            <dd>{getPluginCategory(plugin)}</dd>
            <dt className="text-muted-foreground">开发者</dt>
            <dd>本地插件</dd>
            <dt className="text-muted-foreground">版本</dt>
            <dd>
              {manifest.version}
              {manifest.builtin ? " · 内置" : ""}
              {plugin.source === "external" ? " · 外部" : ""}
            </dd>
            <dt className="text-muted-foreground">插件 ID</dt>
            <dd className="truncate font-mono text-xs">{manifest.id}</dd>
            <dt className="text-muted-foreground">入口</dt>
            <dd className="truncate font-mono text-xs">{manifest.entry}</dd>
            <dt className="text-muted-foreground">API 版本</dt>
            <dd>{manifest.apiVersion}</dd>
            {plugin.source === "external" ? (
              <>
                <dt className="text-muted-foreground">目录</dt>
                <dd className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-mono text-xs" title={plugin.directory}>
                    {plugin.directory}
                  </span>
                  {plugin.directory ? (
                    <Button
                      className="h-6 shrink-0 px-2 text-xs"
                      onClick={() => void revealDirectory()}
                      size="sm"
                      variant="ghost"
                    >
                      <FolderOpen className="size-3.5" /> 打开目录
                    </Button>
                  ) : null}
                </dd>
              </>
            ) : null}
          </dl>
        </section>
      </div>
    </main>
  );
}
