import { useQuery } from "@tanstack/react-query";
import { ExternalLink, GitBranch, GitCommitHorizontal, KeyRound, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { Button } from "@/components/ui/button";
import {
  type CommitActivityDay,
  type CommitApiError,
  fetchCommitOverview,
  fetchRecentCommits,
  loadCommitApiKey,
} from "@/lib/commit";

function CommitPage() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  useEffect(() => {
    void loadCommitApiKey().then((key) => setApiKey(key.trim()));
  }, []);

  const overviewQuery = useQuery({
    queryKey: ["commit", "overview"],
    queryFn: () => fetchCommitOverview(apiKey as string),
    enabled: Boolean(apiKey),
  });
  const commitsQuery = useQuery({
    queryKey: ["commit", "recent"],
    queryFn: () => fetchRecentCommits(apiKey as string),
    enabled: Boolean(apiKey),
  });
  const isLoading = apiKey === null || overviewQuery.isPending || commitsQuery.isPending;
  const isNoKey = apiKey === "";
  const activity = overviewQuery.data?.activity;
  const commits = commitsQuery.data?.data ?? [];
  const error = overviewQuery.error ?? commitsQuery.error;

  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-6 pt-14 pb-10 sm:px-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-medium text-sm text-muted-foreground">Commit</p>
          <h1 className="mt-2 font-semibold text-3xl text-foreground">提交概览</h1>
          <p className="mt-2 max-w-2xl text-muted-foreground text-sm leading-6">
            查看近一年每日提交活跃度，以及最近提交记录。
          </p>
        </div>
        <Button
          disabled={isLoading || isNoKey}
          onClick={() => {
            void overviewQuery.refetch();
            void commitsQuery.refetch();
          }}
          type="button"
          variant="ghost"
        >
          <RefreshCw className={`size-4 ${isLoading ? "animate-spin" : ""}`} /> 刷新
        </Button>
      </header>

      {isNoKey ? (
        <section className="rounded-lg border border-border bg-muted/60 p-5">
          <h2 className="flex items-center gap-2 font-semibold">
            <KeyRound className="size-4" />
            尚未配置 COMMIT_API_KEY
          </h2>
          <p className="mt-2 text-muted-foreground text-sm">
            请先在{" "}
            <Link className="text-foreground underline underline-offset-4" to="/settings">
              设置
            </Link>{" "}
            中填写 Commit Summary API Key。
          </p>
        </section>
      ) : null}
      {error ? (
        <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-5">
          <p className="text-destructive text-sm">加载失败：{(error as CommitApiError).message}</p>
        </section>
      ) : null}
      {isLoading && !isNoKey ? <CommitSkeleton /> : null}
      {activity && !overviewQuery.isError ? (
        <ActivityChart
          activity={activity.days}
          total={activity.totalCommits}
          activeDays={activity.activeDays}
        />
      ) : null}
      {commitsQuery.isSuccess ? (
        <RecentCommits commits={commits} total={commitsQuery.data.total} />
      ) : null}
    </div>
  );
}

function ActivityChart({
  activity,
  total,
  activeDays,
}: {
  activity: CommitActivityDay[];
  total: number;
  activeDays: number;
}) {
  const days = useMemo(() => activity.slice(-84), [activity]);
  const max = Math.max(...days.map((day) => day.count), 1);
  return (
    <section className="rounded-lg border border-border bg-muted/60 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">每日提交</h2>
          <p className="mt-1 text-muted-foreground text-sm">近 12 周 · {activeDays} 个活跃日</p>
        </div>
        <p className="font-mono text-2xl font-semibold tabular-nums">{total.toLocaleString()}</p>
      </div>
      <div
        className="mt-6 grid h-36 grid-flow-col grid-rows-7 gap-1 overflow-hidden"
        aria-label="每日提交统计图"
        role="img"
      >
        {days.map((day) => (
          <span
            className="min-h-0 rounded-sm bg-emerald-500/80"
            key={day.date}
            style={{
              gridRow: `${8 - Math.max(1, Math.ceil((day.count / max) * 7))} / span ${Math.max(1, Math.ceil((day.count / max) * 7))}`,
            }}
            title={`${day.date}: ${day.count} 次提交`}
          />
        ))}
      </div>
    </section>
  );
}

function RecentCommits({
  commits,
  total,
}: {
  commits: Awaited<ReturnType<typeof fetchRecentCommits>>["data"];
  total: number;
}) {
  return (
    <section className="overflow-hidden rounded-lg border border-border bg-muted/60">
      <div className="flex items-center justify-between border-border border-b px-4 py-3">
        <h2 className="font-semibold">最近提交</h2>
        <span className="text-muted-foreground text-sm">共 {total} 条</span>
      </div>
      {commits.length === 0 ? (
        <p className="px-4 py-8 text-center text-muted-foreground text-sm">没有找到提交记录。</p>
      ) : (
        <div className="divide-y divide-border">
          {commits.map((commit) => (
            <article className="flex min-w-0 items-start gap-3 px-4 py-3" key={commit.id}>
              <GitCommitHorizontal className="mt-0.5 size-4 shrink-0 text-emerald-600" />
              <div className="min-w-0 flex-1">
                <a
                  className="group inline-flex max-w-full items-center gap-1 font-medium hover:text-primary"
                  href={commit.htmlUrl}
                  rel="noreferrer"
                  target="_blank"
                >
                  <span className="truncate">
                    {commit.message.split("\n", 1)[0] || "无提交信息"}
                  </span>
                  <ExternalLink className="size-3.5 shrink-0 opacity-0 group-hover:opacity-100" />
                </a>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs">
                  <span>{commit.repository.fullName}</span>
                  {commit.branches[0] ? (
                    <span className="inline-flex items-center gap-1">
                      <GitBranch className="size-3" />
                      {commit.branches[0]}
                    </span>
                  ) : null}
                  <code>{commit.sha.slice(0, 7)}</code>
                </div>
              </div>
              <time
                className="shrink-0 text-muted-foreground text-xs"
                dateTime={commit.committedAt}
              >
                {new Date(commit.committedAt).toLocaleDateString("zh-CN", {
                  month: "short",
                  day: "numeric",
                })}
              </time>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function CommitSkeleton() {
  return (
    <>
      <section className="h-56 animate-pulse rounded-lg border border-border bg-muted/60" />
      <section className="h-64 animate-pulse rounded-lg border border-border bg-muted/60" />
    </>
  );
}

export { CommitPage };
