import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ChartColumn } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ArchiveSource } from "@/lib/chat-archive";
import {
  analyzeHistoryUsage,
  type HistoryUsageAnalysis,
  type UsageCategory,
} from "@/lib/chat-usage";

type SourceFilter = "all" | ArchiveSource;

const SOURCE_FILTERS: Array<{ value: SourceFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "native", label: "本机" },
  { value: "codex", label: "Codex" },
  { value: "claude-code", label: "Claude Code" },
  { value: "cursor", label: "Cursor" },
  { value: "kimi", label: "Kimi" },
];

const CATEGORY_COLORS: Record<string, string> = {
  inputTokens: "bg-sky-500",
  outputTokens: "bg-emerald-500",
  cacheReadTokens: "bg-amber-500",
  cacheWriteTokens: "bg-orange-500",
  reasoningOutputTokens: "bg-violet-500",
};

function HistoryAnalysisPage() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const analysisQuery = useQuery({
    queryKey: ["history-analysis"],
    queryFn: analyzeHistoryUsage,
  });

  const view = useMemo(() => {
    const data = analysisQuery.data;
    if (!data) return null;
    if (sourceFilter === "all") {
      return {
        sessionCount: data.sessionCount,
        sessionsWithUsage: data.sessionsWithUsage,
        messageCount: data.messageCount,
        usage: data.usage,
        categories: data.categories,
      };
    }
    const source = data.bySource.find((item) => item.source === sourceFilter);
    if (!source) {
      return {
        sessionCount: 0,
        sessionsWithUsage: 0,
        messageCount: 0,
        usage: {},
        categories: [] as UsageCategory[],
      };
    }
    return {
      sessionCount: source.sessionCount,
      sessionsWithUsage: source.sessionsWithUsage,
      messageCount: source.messageCount,
      usage: source.usage,
      categories: source.categories,
    };
  }, [analysisQuery.data, sourceFilter]);

  const isInitialLoading = analysisQuery.isPending && !analysisQuery.data;

  return (
    <div className="app-page-root flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-border border-b bg-background px-4 pt-12 pb-4 sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <Button asChild className="mb-3 -ml-2" size="sm" variant="ghost">
              <Link to="/settings/history">
                <ArrowLeft className="size-4" /> 返回 History
              </Link>
            </Button>
            <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
              Chat
            </p>
            <h1 className="mt-2 font-semibold text-3xl tracking-tight">用量分析</h1>
            <p className="mt-2 max-w-2xl text-muted-foreground text-sm">
              汇总本机对话与已导入归档的 token 用量。归档需重新导入后才会带上 Codex / Claude 的
              usage 数据。
            </p>
          </div>
          <Badge variant="secondary" className="gap-1.5">
            <ChartColumn className="size-3.5" />
            Token
          </Badge>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {SOURCE_FILTERS.map((item) => (
            <Button
              key={item.value}
              onClick={() => setSourceFilter(item.value)}
              size="sm"
              type="button"
              variant={sourceFilter === item.value ? "default" : "outline"}
            >
              {item.label}
            </Button>
          ))}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 lg:px-8">
        {analysisQuery.isError ? (
          <p className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
            {analysisQuery.error instanceof Error
              ? analysisQuery.error.message
              : String(analysisQuery.error)}
          </p>
        ) : null}

        {isInitialLoading ? (
          <AnalysisSkeleton />
        ) : !view || view.sessionCount === 0 ? (
          <EmptyAnalysis />
        ) : (
          <div className="space-y-6">
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatCard label="会话数" value={view.sessionCount} />
              <StatCard label="有用量会话" value={view.sessionsWithUsage} />
              <StatCard label="消息数" value={view.messageCount} />
              <StatCard
                label="合计 Token"
                value={view.usage.totalTokens ?? sumCategoryTokens(view.categories)}
              />
            </section>

            <section className="rounded-lg border border-border bg-card">
              <div className="border-border border-b px-5 py-4">
                <h2 className="font-medium text-sm">用量类别占比</h2>
                <p className="mt-1 text-muted-foreground text-xs">
                  基于 API / 源文件记录的 input、output、cache、reasoning 字段。
                </p>
              </div>
              <div className="space-y-5 px-5 py-5">
                {view.categories.length === 0 ? (
                  <p className="text-muted-foreground text-sm">
                    当前筛选下没有可用的 token 用量。可对 Codex / Claude 归档执行覆盖导入。
                  </p>
                ) : (
                  <>
                    <StackedBar categories={view.categories} />
                    <div className="space-y-3">
                      {view.categories.map((category) => (
                        <CategoryRow key={category.key} category={category} />
                      ))}
                    </div>
                  </>
                )}
              </div>
            </section>

            {sourceFilter === "all" && analysisQuery.data ? (
              <SourceBreakdownSection data={analysisQuery.data} />
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

function SourceBreakdownSection({ data }: { data: HistoryUsageAnalysis }) {
  if (data.bySource.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-border border-b px-5 py-4">
        <h2 className="font-medium text-sm">按来源汇总</h2>
      </div>
      <div className="divide-y divide-border">
        {data.bySource.map((source) => (
          <div key={source.source} className="space-y-3 px-5 py-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h3 className="font-medium text-sm">{source.label}</h3>
                <span className="text-muted-foreground text-xs">
                  {source.sessionsWithUsage}/{source.sessionCount} 会话有用量
                </span>
              </div>
              <span className="tabular-nums text-muted-foreground text-xs">
                {(source.usage.totalTokens ?? sumCategoryTokens(source.categories)).toLocaleString(
                  "zh-CN",
                )}{" "}
                tokens
              </span>
            </div>
            {source.categories.length > 0 ? (
              <StackedBar categories={source.categories} />
            ) : (
              <p className="text-muted-foreground text-xs">暂无 usage 数据</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-2 font-semibold text-2xl tabular-nums tracking-tight">
        {value.toLocaleString("zh-CN")}
      </p>
    </div>
  );
}

function StackedBar({ categories }: { categories: UsageCategory[] }) {
  return (
    <div className="flex h-3 overflow-hidden rounded-full bg-muted">
      {categories.map((category) => (
        <div
          key={category.key}
          className={CATEGORY_COLORS[category.key] ?? "bg-muted-foreground"}
          style={{ width: `${Math.max(category.percent, category.tokens > 0 ? 0.5 : 0)}%` }}
          title={`${category.label} ${category.percent.toFixed(1)}%`}
        />
      ))}
    </div>
  );
}

function CategoryRow({ category }: { category: UsageCategory }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span
            className={`size-2.5 rounded-full ${CATEGORY_COLORS[category.key] ?? "bg-muted-foreground"}`}
          />
          <span>{category.label}</span>
        </div>
        <span className="tabular-nums text-muted-foreground">
          {category.tokens.toLocaleString("zh-CN")} · {category.percent.toFixed(1)}%
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full ${CATEGORY_COLORS[category.key] ?? "bg-muted-foreground"}`}
          style={{ width: `${category.percent}%` }}
        />
      </div>
    </div>
  );
}

function sumCategoryTokens(categories: UsageCategory[]) {
  return categories.reduce((sum, category) => sum + category.tokens, 0);
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {["a", "b", "c", "d"].map((key) => (
          <div
            key={key}
            className="h-24 animate-pulse rounded-lg border border-border bg-muted/50"
          />
        ))}
      </div>
      <div className="h-56 animate-pulse rounded-lg border border-border bg-muted/50" />
      <div className="h-40 animate-pulse rounded-lg border border-border bg-muted/50" />
    </div>
  );
}

function EmptyAnalysis() {
  return (
    <div className="rounded-lg border border-border bg-card px-6 py-12 text-center">
      <ChartColumn className="mx-auto size-8 text-muted-foreground" />
      <h2 className="mt-4 font-medium text-base">暂无会话可分析</h2>
      <p className="mt-2 text-muted-foreground text-sm">
        先在 Chat 产生对话，或从 History 导入 Codex / Claude 归档。
      </p>
      <Button asChild className="mt-5" type="button" variant="outline">
        <Link to="/settings/history">回到 History</Link>
      </Button>
    </div>
  );
}

export { HistoryAnalysisPage };
