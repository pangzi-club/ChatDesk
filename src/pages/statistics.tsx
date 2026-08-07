import { useQuery } from "@tanstack/react-query";
import {
  ChartColumn,
  CircleDollarSign,
  Database,
  Download,
  MessageSquare,
  Sparkles,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  analyzeAiUsage,
  tokenTotal,
  type UsageAggregate,
  type UsagePeriod,
} from "@/lib/ai-usage-statistics";

const PERIODS: Array<{ value: UsagePeriod; label: string }> = [
  { value: "today", label: "今天" },
  { value: "week", label: "本周" },
  { value: "month", label: "本月" },
  { value: "30d", label: "过去 30 天" },
  { value: "year", label: "过去一年" },
];

function formatNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return value.toLocaleString("zh-CN");
}

function formatMoney(value?: number) {
  return value === undefined ? "暂无价格" : `$${value.toFixed(3)}`;
}

function StatCard({
  label,
  value,
  icon: Icon,
  detail,
}: {
  label: string;
  value: string;
  icon: typeof ChartColumn;
  detail?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4 shadow-xs">
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <Icon className="size-4" />
        {label}
      </div>
      <p className="mt-3 font-semibold text-2xl tabular-nums tracking-tight">{value}</p>
      {detail ? <p className="mt-1 text-muted-foreground text-xs">{detail}</p> : null}
    </div>
  );
}

function UsageBar({
  items,
  value,
}: {
  items: UsageAggregate[];
  value: (item: UsageAggregate) => number;
}) {
  const max = Math.max(...items.map(value), 1);
  return (
    <div className="space-y-3">
      {items.slice(0, 10).map((item) => {
        const amount = value(item);
        return (
          <div key={`${item.provider}-${item.model}`}>
            <div className="mb-1 flex justify-between gap-3 text-xs">
              <span className="truncate">
                {item.provider}
                {item.model !== "全部" ? ` / ${item.model}` : ""}
              </span>
              <span className="tabular-nums text-muted-foreground">{formatMoney(item.cost)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${Math.max((amount / max) * 100, amount > 0 ? 2 : 0)}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Heatmap({
  days,
}: {
  days: Array<{
    date: string;
    usage: { totalTokens?: number; inputTokens?: number; outputTokens?: number };
    messageCount: number;
  }>;
}) {
  const max = Math.max(...days.map((day) => tokenTotal(day.usage)), 1);
  return (
    <div className="overflow-x-auto pb-1">
      <div className="grid auto-cols-[12px] grid-flow-col grid-rows-7 justify-start gap-[4px]">
        {days.map((day) => {
          const intensity = tokenTotal(day.usage) / max;
          return (
            <div
              className="size-3 rounded-[3px] border border-border/70"
              key={day.date}
              title={`${day.date} · ${formatNumber(tokenTotal(day.usage))} tokens`}
              style={{
                backgroundColor: tokenTotal(day.usage)
                  ? `color-mix(in srgb, var(--primary) ${Math.round(20 + intensity * 75)}%, transparent)`
                  : undefined,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function DetailsTable({ rows }: { rows: UsageAggregate[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] text-left text-sm">
        <thead className="border-border border-b text-muted-foreground text-xs">
          <tr>
            {["模型", "供应商", "消息数", "输入", "输出", "缓存读", "缓存写", "费用"].map(
              (heading) => (
                <th className="px-3 py-3 font-medium" key={heading}>
                  {heading}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={`${row.provider}-${row.model}-${row.source}`}>
              <td className="max-w-[180px] truncate px-3 py-3 font-medium" title={row.model}>
                {row.model}
              </td>
              <td className="px-3 py-3 text-muted-foreground">{row.provider}</td>
              <td className="px-3 py-3 tabular-nums">{row.messageCount.toLocaleString("zh-CN")}</td>
              <td className="px-3 py-3 tabular-nums">{formatNumber(row.usage.inputTokens ?? 0)}</td>
              <td className="px-3 py-3 tabular-nums">
                {formatNumber(row.usage.outputTokens ?? 0)}
              </td>
              <td className="px-3 py-3 tabular-nums">
                {formatNumber(row.usage.cacheReadTokens ?? 0)}
              </td>
              <td className="px-3 py-3 tabular-nums">
                {formatNumber(row.usage.cacheWriteTokens ?? 0)}
              </td>
              <td className="px-3 py-3 tabular-nums">{formatMoney(row.cost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StatisticsSettingsPage() {
  const [period, setPeriod] = useState<UsagePeriod>("month");
  const query = useQuery({
    queryKey: ["ai-usage-statistics", period],
    queryFn: () => analyzeAiUsage(period),
    staleTime: 30_000,
    gcTime: 5 * 60_000,
  });
  const data = query.data;
  const maxDailyCost = Math.max(...(data?.daily.map((day) => day.cost ?? 0) ?? [0]), 0.001);
  const unknownCost = data?.total.hasUnknownCost;
  const chartDays = useMemo(() => data?.daily ?? [], [data]);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
            AI
          </p>
          <h1 className="mt-2 flex items-center gap-2 font-semibold text-3xl tracking-tight">
            <ChartColumn className="size-7" />
            使用量
          </h1>
          <p className="mt-2 text-muted-foreground text-sm">
            汇总本地 Chat、Codex 和 Claude Code 的模型用量。
          </p>
        </div>
        <Select value={period} onValueChange={(value) => setPeriod(value as UsagePeriod)}>
          <SelectTrigger className="w-36 bg-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </header>
      {query.isError ? (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          <TriangleAlert className="size-4" />
          读取统计失败，请重试。
        </div>
      ) : null}
      {query.isPending && !data ? (
        <div className="space-y-6" aria-busy="true">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((key) => (
              <div
                className="h-28 animate-pulse rounded-lg border border-border bg-muted/50"
                key={key}
              />
            ))}
          </div>
          <div className="h-56 animate-pulse rounded-lg border border-border bg-muted/50" />
          <div className="h-72 animate-pulse rounded-lg border border-border bg-muted/50" />
        </div>
      ) : data && data.total.messageCount === 0 ? (
        <div className="rounded-lg border border-border bg-card px-6 py-14 text-center">
          <Sparkles className="mx-auto size-8 text-muted-foreground" />
          <h2 className="mt-4 font-medium">暂无 AI 用量</h2>
          <p className="mt-2 text-muted-foreground text-sm">
            在 Chat 中完成一次对话后，这里会显示统计。
          </p>
        </div>
      ) : data ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <StatCard
              icon={CircleDollarSign}
              label="估算费用"
              value={formatMoney(data.total.cost)}
              detail={unknownCost ? "部分记录缺少价格" : "按模型价格估算"}
            />
            <StatCard
              icon={MessageSquare}
              label="消息数"
              value={data.total.messageCount.toLocaleString("zh-CN")}
            />
            <StatCard
              icon={Download}
              label="输入 Token"
              value={formatNumber(data.total.usage.inputTokens ?? 0)}
            />
            <StatCard
              icon={Upload}
              label="输出 Token"
              value={formatNumber(data.total.usage.outputTokens ?? 0)}
            />
            <StatCard
              icon={Database}
              label="缓存读取"
              value={formatNumber(data.total.usage.cacheReadTokens ?? 0)}
            />
            <StatCard
              icon={Database}
              label="缓存写入"
              value={formatNumber(data.total.usage.cacheWriteTokens ?? 0)}
            />
          </div>
          <section className="rounded-lg border border-border bg-card px-5 py-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-medium">活动热力图</h2>
                <p className="mt-1 text-muted-foreground text-xs">过去一年的每日 Token 用量</p>
              </div>
              <Badge variant="secondary">
                {formatNumber(data.heatmap.reduce((sum, day) => sum + tokenTotal(day.usage), 0))}{" "}
                tokens
              </Badge>
            </div>
            <div className="mt-6">
              <Heatmap days={data.heatmap} />
            </div>
          </section>
          <section className="rounded-lg border border-border bg-card px-5 py-5">
            <div>
              <h2 className="font-medium">费用趋势</h2>
              <p className="mt-1 text-muted-foreground text-xs">
                {data.from} 至 {data.to} 的每日估算支出
              </p>
            </div>
            <div className="mt-7 flex h-44 items-end gap-1 border-border border-b">
              {chartDays.map((day) => (
                <div
                  className="group relative flex-1"
                  key={day.date}
                  title={`${day.date} · ${formatMoney(day.cost)}`}
                >
                  <div
                    className="mx-auto w-full max-w-8 rounded-t-sm bg-primary/75 transition-colors group-hover:bg-primary"
                    style={{
                      height: `${Math.max(((day.cost ?? 0) / maxDailyCost) * 100, day.cost ? 3 : 0)}%`,
                    }}
                  />
                </div>
              ))}
            </div>
          </section>
          <div className="grid gap-6 xl:grid-cols-2">
            <section className="rounded-lg border border-border bg-card px-5 py-5">
              <h2 className="font-medium">按提供商统计</h2>
              <p className="mt-1 mb-5 text-muted-foreground text-xs">按 AI 提供商的 Token 分布</p>
              <UsageBar items={data.byProvider} value={(item) => tokenTotal(item.usage)} />
            </section>
            <section className="rounded-lg border border-border bg-card px-5 py-5">
              <h2 className="font-medium">按模型统计</h2>
              <p className="mt-1 mb-5 text-muted-foreground text-xs">Token 用量最高的模型</p>
              <UsageBar items={data.byModel} value={(item) => tokenTotal(item.usage)} />
            </section>
          </div>
          <section className="rounded-lg border border-border bg-card px-5 py-5">
            <div className="mb-4">
              <h2 className="font-medium">详细统计</h2>
              <p className="mt-1 text-muted-foreground text-xs">按模型和来源汇总的完整使用明细</p>
            </div>
            <DetailsTable rows={data.details} />
          </section>
        </>
      ) : null}
    </div>
  );
}

export { StatisticsSettingsPage };
