import { useQuery } from "@tanstack/react-query";
import { ChartColumn, RefreshCw } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  DataerApiError,
  type DataerInterval,
  type DataerSite,
  type DataerSiteStats,
  fetchAllSites,
  fetchSiteReport,
  loadDataerApiKey,
} from "@/lib/dataer";

const INTERVALS: Array<{ value: DataerInterval; label: string }> = [
  { value: "today", label: "今天" },
  { value: "yesterday", label: "昨天" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
  { value: "90d", label: "近 90 天" },
];

const REPORT_CONCURRENCY = 4;
const TABLE_SKELETON_ROWS = ["one", "two", "three", "four", "five"];
const TABLE_SKELETON_COLUMNS = ["site", "domain", "views", "visitors", "bounceRate", "status"];

interface SiteRow {
  site: DataerSite;
  stats: DataerSiteStats | null;
  error: string | null;
}

interface AnalyticsData {
  rows: SiteRow[];
  hasApiKey: boolean;
}

function AnalyticsPage() {
  const [interval, setInterval] = useState<DataerInterval>("7d");
  const analyticsQuery = useQuery<AnalyticsData, DataerApiError>({
    queryKey: ["dataer", "analytics", interval],
    queryFn: () => fetchAnalytics(interval),
    placeholderData: (previous) => previous,
  });
  const rows = analyticsQuery.data?.rows ?? [];
  const isInitialLoading = analyticsQuery.isPending && !analyticsQuery.data;
  const isNoApiKey = analyticsQuery.data?.hasApiKey === false;

  const totals = rows.reduce(
    (acc, row) => {
      if (row.stats) {
        acc.views += row.stats.views;
        acc.visitors += row.stats.visitors;
        acc.bounces += row.stats.bounces;
      }
      return acc;
    },
    { views: 0, visitors: 0, bounces: 0 },
  );
  const overallBounceRate = totals.views > 0 ? totals.bounces / totals.views : 0;

  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-6 pt-14 pb-10 sm:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-medium text-sm text-muted-foreground">Analytics</p>
          <h1 className="mt-2 font-semibold text-3xl text-foreground tracking-normal">流量分析</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
            来自 tandataer.com 的全部网站浏览数据。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {INTERVALS.map((item) => (
            <button
              className={`h-9 rounded-md border px-3 text-sm transition-colors ${
                interval === item.value
                  ? "border-foreground bg-foreground text-background"
                  : "border-border bg-background text-muted-foreground hover:bg-muted"
              }`}
              key={item.value}
              onClick={() => setInterval(item.value)}
              type="button"
            >
              {item.label}
            </button>
          ))}
          <Button
            disabled={analyticsQuery.isFetching}
            onClick={() => void analyticsQuery.refetch()}
            type="button"
            variant="ghost"
          >
            <RefreshCw className={`size-4 ${analyticsQuery.isFetching ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </header>

      {isNoApiKey ? (
        <section className="rounded-lg border border-border bg-muted/60 p-5">
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <ChartColumn className="size-4" />
            尚未配置 API Key
          </h2>
          <p className="mt-2 text-muted-foreground text-sm leading-6">
            请先在{" "}
            <Link className="text-foreground underline underline-offset-4" to="/settings">
              设置
            </Link>{" "}
            中填写 DATAER_API_KEY，然后回到本页刷新。
          </p>
        </section>
      ) : null}

      {analyticsQuery.isError ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-5">
          <p className="text-destructive text-sm">
            加载失败：{describeError(analyticsQuery.error)}
          </p>
        </section>
      ) : null}

      {isInitialLoading && !isNoApiKey ? <AnalyticsTableSkeleton /> : null}

      {!isInitialLoading && !isNoApiKey && analyticsQuery.data ? (
        <section className="overflow-hidden rounded-lg border border-border bg-muted/60">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead>
                <tr className="border-border border-b text-muted-foreground">
                  <th className="px-4 py-3 font-medium">网站</th>
                  <th className="px-4 py-3 font-medium">域名</th>
                  <th className="px-4 py-3 text-right font-medium">浏览量</th>
                  <th className="px-4 py-3 text-right font-medium">访客数</th>
                  <th className="px-4 py-3 text-right font-medium">跳出率</th>
                  <th className="px-4 py-3 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    className="border-border border-b last:border-b-0 hover:bg-muted/80"
                    key={row.site.ref}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">{row.site.name}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.site.domains.join(", ") || "-"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {row.stats ? row.stats.views.toLocaleString() : cellPlaceholder(row)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {row.stats ? row.stats.visitors.toLocaleString() : cellPlaceholder(row)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-foreground">
                      {row.stats ? formatPercent(row.stats.bounceRate) : cellPlaceholder(row)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                          row.site.enabled
                            ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                            : "bg-muted text-muted-foreground"
                        }`}
                      >
                        {row.site.enabled ? "启用" : "停用"}
                      </span>
                    </td>
                  </tr>
                ))}
                {analyticsQuery.isSuccess && rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-muted-foreground" colSpan={6}>
                      没有找到任何网站。
                    </td>
                  </tr>
                ) : null}
              </tbody>
              {rows.some((row) => row.stats) ? (
                <tfoot>
                  <tr className="border-border border-t bg-background/60 font-medium text-foreground">
                    <td className="px-4 py-3">合计</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3 text-right tabular-nums">
                      {totals.views.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {totals.visitors.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {formatPercent(overallBounceRate)}
                    </td>
                    <td className="px-4 py-3" />
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}

async function fetchAnalytics(interval: DataerInterval): Promise<AnalyticsData> {
  const apiKey = (await loadDataerApiKey()).trim();
  if (!apiKey) {
    return { rows: [], hasApiKey: false };
  }

  const sites = await fetchAllSites(apiKey);
  const rows: SiteRow[] = sites.map((site) => ({ site, stats: null, error: null }));
  const queue = [...sites];

  async function worker() {
    while (queue.length > 0) {
      const site = queue.shift();
      if (!site) {
        return;
      }

      const row = rows.find((item) => item.site.ref === site.ref);
      if (!row) {
        continue;
      }

      try {
        const report = await fetchSiteReport(apiKey, site.ref, interval);
        row.stats = report.stats;
      } catch (error) {
        row.error = describeError(error);
      }
    }
  }

  await Promise.all(Array.from({ length: REPORT_CONCURRENCY }, () => worker()));
  return { rows, hasApiKey: true };
}

function AnalyticsTableSkeleton() {
  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-muted/60"
      aria-label="正在加载分析数据"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-border border-b text-muted-foreground">
              {TABLE_SKELETON_COLUMNS.map((column) => (
                <th className="px-4 py-3" key={column}>
                  <div className="h-4 w-16 animate-pulse rounded bg-muted-foreground/15" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {TABLE_SKELETON_ROWS.map((row) => (
              <tr className="border-border border-b last:border-b-0" key={row}>
                {TABLE_SKELETON_COLUMNS.map((cell) => (
                  <td className="px-4 py-4" key={cell}>
                    <div className="h-4 w-full max-w-32 animate-pulse rounded bg-muted-foreground/15" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function cellPlaceholder(row: SiteRow) {
  if (row.error) {
    return <span className="text-destructive text-xs">{row.error}</span>;
  }
  return <span className="text-muted-foreground">…</span>;
}

function formatPercent(value: number) {
  const percent = value <= 1 ? value * 100 : value;
  return `${percent.toFixed(1)}%`;
}

function describeError(error: unknown) {
  if (error instanceof DataerApiError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "未知错误";
}

export { AnalyticsPage };
