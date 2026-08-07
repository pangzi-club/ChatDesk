import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, KeyRound, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  type FindMonitorsResult,
  fetchMonitor,
  fetchMonitors,
  LookerApiError,
  loadLookerApiKey,
} from "@/lib/looker";

const LIST_SKELETON_ROWS = ["one", "two", "three", "four", "five"];
const DETAIL_SKELETON_STATS = ["status", "updates", "keywords"];
const DETAIL_SKELETON_ITEMS = ["first", "second", "third"];

function LookerPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    void loadLookerApiKey().then((key) => setApiKey(key.trim()));
  }, []);

  const monitorsQuery = useQuery<FindMonitorsResult, LookerApiError>({
    queryKey: ["looker", "monitors"],
    queryFn: () => fetchMonitors(apiKey as string),
    enabled: Boolean(apiKey),
  });
  const monitors = monitorsQuery.data?.monitors ?? [];
  const isLoading = apiKey === null || monitorsQuery.isPending;
  const isNoKey = apiKey === "";

  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-6 pt-14 pb-10 sm:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-medium text-sm text-muted-foreground">Looker</p>
          <h1 className="mt-2 font-semibold text-3xl text-foreground">监控</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
            通过 tan-looker API 浏览和管理你的内容监控。
          </p>
        </div>
        <Button
          disabled={isLoading}
          onClick={() => void monitorsQuery.refetch()}
          type="button"
          variant="ghost"
        >
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} />
          刷新
        </Button>
      </header>

      {isNoKey ? (
        <section className="rounded-lg border border-border bg-muted/60 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <KeyRound className="size-4" />
            尚未配置 LOOKER_API_KEY
          </h2>
          <p className="mt-2 text-muted-foreground text-sm leading-6">
            请先在{" "}
            <Link className="text-foreground underline underline-offset-4" to="/settings">
              设置
            </Link>{" "}
            中填写 Looker API Key。
          </p>
        </section>
      ) : null}

      {monitorsQuery.isError ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-5">
          <p className="text-destructive text-sm">
            加载失败：{monitorsQuery.error?.message ?? "请重试"}
          </p>
        </section>
      ) : null}

      {isLoading && !isNoKey ? <MonitorListSkeleton /> : null}

      {monitorsQuery.isSuccess ? (
        <section className="overflow-hidden rounded-lg border border-border bg-muted/60">
          <div className="flex items-center justify-between border-border border-b px-4 py-3">
            <h2 className="font-semibold text-foreground">全部监控</h2>
            <span className="text-muted-foreground text-sm">{monitors.length} 个</span>
          </div>
          {monitors.length === 0 ? (
            <p className="px-4 py-8 text-center text-muted-foreground text-sm">
              没有找到可访问的监控。
            </p>
          ) : (
            <div className="divide-y divide-border">
              {monitors.map((monitor) => (
                <article
                  className="flex items-center justify-between gap-4 px-4 py-3"
                  key={monitor.ref}
                >
                  <Link
                    className="min-w-0 flex-1"
                    to={`/dev-tools/looker/${encodeURIComponent(monitor.ref)}`}
                  >
                    <h3 className="truncate font-medium text-foreground">
                      {monitor.name || monitor.publicId || "未命名监控"}
                    </h3>
                    <p className="mt-1 truncate text-muted-foreground text-xs">
                      {monitor.taskTypeName} · {monitor.frequency} ·{" "}
                      {monitor.enabled ? "启用" : "停用"}
                    </p>
                  </Link>
                  {monitor.webUrl ? (
                    <a
                      className="shrink-0 text-muted-foreground hover:text-foreground"
                      href={monitor.webUrl}
                      rel="noreferrer"
                      target="_blank"
                      title="在 Looker 中打开"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}

function LookerDetailPage() {
  const { ref = "" } = useParams<{ ref: string }>();
  const [apiKey, setApiKey] = useState<string | null>(null);

  useEffect(() => {
    void loadLookerApiKey().then((key) => setApiKey(key.trim()));
  }, []);

  const detailQuery = useQuery({
    queryKey: ["looker", "monitor", ref],
    queryFn: () => fetchMonitor(ref, apiKey as string),
    enabled: Boolean(apiKey) && Boolean(ref),
  });
  const monitor = detailQuery.data?.monitor ?? null;
  const items = detailQuery.data?.items ?? [];
  const isLoading = apiKey === null || detailQuery.isPending;
  const isNoKey = apiKey === "";

  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-6 pt-14 pb-10 sm:px-10">
      <nav className="flex items-center gap-2 text-sm text-muted-foreground" aria-label="面包屑">
        <Link className="hover:text-foreground" to="/dev-tools/looker">
          Looker
        </Link>
        <span>/</span>
        <Link className="hover:text-foreground" to="/dev-tools/looker">
          监控
        </Link>
        <span>/</span>
        <span className="truncate text-foreground">{monitor?.name || ref}</span>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            className="mb-3 inline-flex items-center gap-1 text-muted-foreground text-sm hover:text-foreground"
            to="/dev-tools/looker"
          >
            <ArrowLeft className="size-4" /> 返回监控列表
          </Link>
          <h1 className="font-semibold text-3xl text-foreground">{monitor?.name || "监控详情"}</h1>
          {monitor ? (
            <p className="mt-2 text-muted-foreground text-sm">
              {monitor.taskTypeName} · {monitor.frequency}
            </p>
          ) : null}
        </div>
        <Button
          disabled={isLoading}
          onClick={() => void detailQuery.refetch()}
          type="button"
          variant="ghost"
        >
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} /> 刷新
        </Button>
      </header>
      {isNoKey ? (
        <section className="rounded-lg border border-border bg-muted/60 p-5">
          <p className="text-muted-foreground text-sm">
            请先在{" "}
            <Link className="text-foreground underline" to="/settings">
              设置
            </Link>{" "}
            中填写 LOOKER_API_KEY。
          </p>
        </section>
      ) : null}
      {detailQuery.isError ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-5">
          <p className="text-destructive text-sm">
            加载失败：
            {detailQuery.error instanceof LookerApiError ? detailQuery.error.message : "请重试"}
          </p>
        </section>
      ) : null}
      {isLoading && !isNoKey ? <MonitorDetailSkeleton /> : null}
      {detailQuery.isSuccess && monitor ? (
        <>
          <section className="grid gap-3 sm:grid-cols-3">
            <DetailStat label="状态" value={monitor.enabled ? "启用" : "停用"} />
            <DetailStat label="更新状态" value={monitor.hasUpdate ? "有新内容" : "暂无更新"} />
            <DetailStat label="关键词" value={monitor.keywords.join("、") || "未设置"} />
          </section>
          <section className="overflow-hidden rounded-lg border border-border bg-muted/60">
            <div className="border-border border-b px-4 py-3 font-semibold text-foreground">
              最新内容
            </div>
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-muted-foreground text-sm">暂无内容。</p>
            ) : (
              <div className="divide-y divide-border">
                {items.map((item) => (
                  <article className="px-4 py-4" key={item.id}>
                    <div className="flex items-start justify-between gap-3">
                      <h2 className="font-medium text-foreground">{item.title || "无标题"}</h2>
                      {item.webUrl ? (
                        <a
                          className="text-muted-foreground hover:text-foreground"
                          href={item.webUrl}
                          rel="noreferrer"
                          target="_blank"
                          title="打开原文"
                        >
                          <ExternalLink className="size-4" />
                        </a>
                      ) : null}
                    </div>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-muted-foreground text-sm leading-6">
                      {item.content || "暂无摘要"}
                    </p>
                    <p className="mt-2 text-muted-foreground text-xs">
                      {item.source.name || "未知来源"}
                      {item.publishedAt ? ` · ${new Date(item.publishedAt).toLocaleString()}` : ""}
                    </p>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function MonitorListSkeleton() {
  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-muted/60"
      aria-label="正在加载监控"
    >
      <div className="flex items-center justify-between border-border border-b px-4 py-3">
        <div className="h-5 w-24 animate-pulse rounded bg-muted-foreground/15" />
        <div className="h-4 w-12 animate-pulse rounded bg-muted-foreground/15" />
      </div>
      <div className="divide-y divide-border">
        {LIST_SKELETON_ROWS.map((row) => (
          <div className="flex items-center justify-between gap-4 px-4 py-4" key={row}>
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-4 w-2/5 animate-pulse rounded bg-muted-foreground/15" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted-foreground/15" />
            </div>
            <div className="size-4 animate-pulse rounded bg-muted-foreground/15" />
          </div>
        ))}
      </div>
    </section>
  );
}

function MonitorDetailSkeleton() {
  return (
    <>
      <div className="h-9 w-72 animate-pulse rounded bg-muted-foreground/15" />
      <section className="grid gap-3 sm:grid-cols-3">
        {DETAIL_SKELETON_STATS.map((stat) => (
          <div
            className="h-20 animate-pulse rounded-lg border border-border bg-muted/60"
            key={stat}
          />
        ))}
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-muted/60">
        <div className="h-11 animate-pulse border-border border-b bg-muted-foreground/10" />
        <div className="space-y-4 p-4">
          {DETAIL_SKELETON_ITEMS.map((item) => (
            <div className="space-y-3 border-border border-b pb-4 last:border-0" key={item}>
              <div className="h-4 w-3/5 animate-pulse rounded bg-muted-foreground/15" />
              <div className="h-3 w-full animate-pulse rounded bg-muted-foreground/15" />
              <div className="h-3 w-4/5 animate-pulse rounded bg-muted-foreground/15" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function DetailStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/60 p-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-medium text-foreground text-sm">{value}</p>
    </div>
  );
}

export { LookerDetailPage, LookerPage };
