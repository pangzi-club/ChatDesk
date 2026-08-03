import { ChartColumn, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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

interface SiteRow {
  site: DataerSite;
  stats: DataerSiteStats | null;
  error: string | null;
}

type LoadState = "loading" | "ready" | "no-api-key" | "error";

function AnalyticsPage() {
  const [interval, setInterval] = useState<DataerInterval>("7d");
  const [rows, setRows] = useState<SiteRow[]>([]);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  const load = useCallback(async () => {
    setLoadState("loading");
    setErrorMessage("");
    setRows([]);

    const apiKey = (await loadDataerApiKey()).trim();
    if (!apiKey) {
      setLoadState("no-api-key");
      return;
    }

    let sites: DataerSite[];
    try {
      sites = await fetchAllSites(apiKey);
    } catch (error) {
      setErrorMessage(describeError(error));
      setLoadState("error");
      return;
    }

    const initialRows: SiteRow[] = sites.map((site) => ({ site, stats: null, error: null }));
    setRows(initialRows);

    // 限流并发地拉取每个网站的报表，逐行填充
    const queue = [...sites];
    async function worker() {
      while (queue.length > 0) {
        const site = queue.shift();
        if (!site) {
          return;
        }

        try {
          const report = await fetchSiteReport(apiKey, site.ref, interval);
          setRows((currentRows) =>
            currentRows.map((row) =>
              row.site.ref === site.ref ? { ...row, stats: report.stats } : row,
            ),
          );
        } catch (error) {
          setRows((currentRows) =>
            currentRows.map((row) =>
              row.site.ref === site.ref ? { ...row, error: describeError(error) } : row,
            ),
          );
        }
      }
    }

    await Promise.all(Array.from({ length: REPORT_CONCURRENCY }, () => worker()));
    setLoadState("ready");
  }, [interval]);

  useEffect(() => {
    void refreshToken; // refreshToken 变化时重新加载
    void load();
  }, [load, refreshToken]);

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
            disabled={loadState === "loading"}
            onClick={() => setRefreshToken((token) => token + 1)}
            type="button"
            variant="ghost"
          >
            <RefreshCw className={`size-4 ${loadState === "loading" ? "animate-spin" : ""}`} />
            刷新
          </Button>
        </div>
      </header>

      {loadState === "no-api-key" ? (
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

      {loadState === "error" ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-5">
          <p className="text-destructive text-sm">加载失败：{errorMessage}</p>
        </section>
      ) : null}

      {loadState !== "no-api-key" && loadState !== "error" ? (
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
                {loadState === "loading" && rows.length === 0 ? (
                  <tr>
                    <td className="px-4 py-8 text-center text-muted-foreground" colSpan={6}>
                      正在加载网站数据…
                    </td>
                  </tr>
                ) : null}
                {loadState === "ready" && rows.length === 0 ? (
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
