import { Package, Plug, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useDesktopUi } from "@/lib/desktop-ui";

export function PluginsPage() {
  const runtime = useDesktopUi();
  const [, setRevision] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const plugins = runtime.scanPlugins();
  async function toggle(id: string, installed: boolean) {
    setBusy(id);
    setError(null);
    try {
      if (installed) await runtime.uninstallPlugin(id);
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
    <main className="h-full overflow-y-auto bg-background px-6 py-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center gap-3">
          <Package className="size-5 text-muted-foreground" />
          <div>
            <h1 className="font-semibold text-lg">Plugins</h1>
            <p className="text-muted-foreground text-sm">
              本地预定义目录中的插件。安装即启用，卸载即禁用。
            </p>
          </div>
        </div>
        {error ? (
          <div className="mb-4 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive text-sm">
            <TriangleAlert className="size-4" />
            {error}
          </div>
        ) : null}
        <div className="divide-y rounded-lg border bg-card">
          {plugins.map((plugin) => {
            const manifest = plugin.manifest;
            const id = manifest?.id ?? plugin.entry;
            return (
              <div className="flex items-start justify-between gap-4 p-4" key={id}>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Plug className="size-4 text-muted-foreground" />
                    <span className="font-medium">
                      {manifest?.name ?? manifest?.id ?? "未知插件"}
                    </span>
                    <Badge
                      variant={
                        plugin.installable
                          ? plugin.installed
                            ? "default"
                            : "secondary"
                          : "destructive"
                      }
                    >
                      {plugin.installable ? (plugin.installed ? "已安装" : "可安装") : "不可用"}
                    </Badge>
                  </div>
                  {manifest?.name ? (
                    <div className="mt-1 font-mono text-muted-foreground text-xs">
                      {manifest.id}
                    </div>
                  ) : null}
                  {manifest?.description ? (
                    <p className="mt-2 text-sm">{manifest.description}</p>
                  ) : null}
                  {manifest?.contributes.includes("workspace.tab") ? (
                    <p className="mt-1 text-muted-foreground text-xs">
                      使用方式：安装后打开 Workspace 标签栏右侧的“+”菜单。
                    </p>
                  ) : null}
                  <div className="mt-2 text-muted-foreground text-xs">
                    版本 {manifest?.version ?? "-"} · API {String(manifest?.apiVersion ?? "-")} ·
                    入口 <code>{plugin.entry}</code>
                  </div>
                  <div className="mt-1 text-muted-foreground text-xs">
                    贡献：{manifest?.contributes?.join(", ") || "无"}
                  </div>
                  {plugin.errors.map((item) => (
                    <div className="mt-1 text-destructive text-xs" key={item.code}>
                      {item.message}
                    </div>
                  ))}
                </div>
                {plugin.installable && manifest ? (
                  <Button
                    size="sm"
                    variant={plugin.installed ? "outline" : "default"}
                    disabled={busy === manifest.id}
                    onClick={() => void toggle(manifest.id, plugin.installed)}
                  >
                    {busy === manifest.id ? "处理中…" : plugin.installed ? "卸载" : "安装"}
                  </Button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </main>
  );
}
