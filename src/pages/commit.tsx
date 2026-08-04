import { useQuery } from "@tanstack/react-query";
import { GitBranch, KeyRound } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  type CommitActivityDay,
  type CommitApiError,
  type CommitItem,
  fetchCommitOverview,
  fetchRecentCommits,
  loadCommitApiKey,
} from "@/lib/commit";

type CalendarCell = CommitActivityDay & { inRange: boolean; level: number };
type CalendarWeek = { cells: CalendarCell[]; monthLabel: string | null };
type CommitGroup = { dateLabel: string; items: CommitItem[] };

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

  const isNoKey = apiKey === "";
  const isInitialLoading = apiKey !== "" && (overviewQuery.isPending || commitsQuery.isPending);
  const activity = overviewQuery.data?.activity;
  const commits = commitsQuery.data?.data ?? [];
  const error = overviewQuery.error ?? commitsQuery.error;

  return (
    <div className="commit-page flex w-full flex-1 flex-col gap-6 px-4 pt-12 pb-6 sm:px-6 lg:px-8">
      {isNoKey ? <MissingApiKey /> : null}
      {error ? (
        <section className="commit-notice commit-notice-error">
          加载失败：{(error as CommitApiError).message}
        </section>
      ) : null}
      {isInitialLoading ? <CommitSkeleton /> : null}
      {activity && !overviewQuery.isError ? (
        <ActivityPanel
          activity={activity.days}
          rangeStart={activity.rangeStart}
          rangeEnd={activity.rangeEnd}
          total={activity.totalCommits}
        />
      ) : null}
      {commitsQuery.isSuccess ? <RecentPanel commits={commits} /> : null}
      {!isNoKey && !isInitialLoading && !error && !activity && !commitsQuery.data ? (
        <EmptyCommitState />
      ) : null}
    </div>
  );
}

function MissingApiKey() {
  return (
    <section className="commit-notice">
      <h1 className="flex items-center gap-2 font-semibold text-foreground">
        <KeyRound className="size-4" />
        尚未配置 COMMIT_API_KEY
      </h1>
      <p className="mt-2 text-muted-foreground text-sm">
        请先在{" "}
        <Link className="text-foreground underline underline-offset-4" to="/settings">
          设置
        </Link>{" "}
        中填写 Commit Summary API Key。
      </p>
    </section>
  );
}

function ActivityPanel({
  activity,
  rangeStart,
  rangeEnd,
  total,
}: {
  activity: CommitActivityDay[];
  rangeStart: string;
  rangeEnd: string;
  total: number;
}) {
  const weeks = useMemo(
    () => buildCalendar(activity, rangeStart, rangeEnd),
    [activity, rangeEnd, rangeStart],
  );
  const periodLabel = `${formatLongDate(rangeStart)} 至 ${formatLongDate(rangeEnd)}`;

  return (
    <section className="commit-panel">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h1 className="commit-panel-title">近一年共 {total.toLocaleString()} 次提交</h1>
          <p className="commit-panel-subtitle">按天查看与你绑定的 GitHub 身份匹配到的提交记录。</p>
        </div>
      </div>

      <div className="commit-calendar-shell" aria-label="近一年每日提交热力图" role="img">
        <div className="commit-weekday-labels" aria-hidden="true">
          <span />
          <span>周一</span>
          <span />
          <span>周三</span>
          <span />
          <span>周五</span>
          <span />
        </div>
        <div className="commit-calendar-scroll">
          <div className="commit-calendar-track" style={{ minWidth: `${weeks.length * 15}px` }}>
            <div
              className="commit-month-row"
              style={{ gridTemplateColumns: `repeat(${weeks.length}, 10px)` }}
            >
              {weeks.map((week) => (
                <span key={week.cells[0]?.date ?? "empty"}>{week.monthLabel}</span>
              ))}
            </div>
            <div
              className="commit-cell-grid"
              style={{ gridTemplateColumns: `repeat(${weeks.length}, 10px)` }}
            >
              {weeks
                .flatMap((week) => week.cells)
                .map((cell) => (
                  <span
                    className={`commit-cell commit-cell-${cell.level}${cell.inRange ? "" : " commit-cell-outside"}`}
                    key={cell.date}
                    title={`${cell.date}: ${cell.count} 次提交`}
                  />
                ))}
            </div>
          </div>
        </div>
      </div>

      <div className="commit-panel-footer">
        <span>{periodLabel}</span>
        <div className="commit-legend">
          <span>少</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i className={`commit-cell commit-cell-${level}`} key={level} />
          ))}
          <span>多</span>
        </div>
      </div>
    </section>
  );
}

function RecentPanel({ commits }: { commits: CommitItem[] }) {
  const groups = useMemo(() => groupCommits(commits), [commits]);

  return (
    <section className="commit-panel" id="recent-commits">
      <div className="flex flex-wrap items-start justify-between gap-5">
        <div>
          <h2 className="commit-panel-title">近期活动</h2>
          <p className="commit-panel-subtitle">查看最近从已连接仓库同步的提交。</p>
        </div>
      </div>
      <div className="commit-divider" />
      {groups.length === 0 ? (
        <p className="py-10 text-center text-muted-foreground text-sm">没有找到提交记录。</p>
      ) : (
        <div className="commit-timeline">
          {groups.map((group) => (
            <div className="commit-timeline-group" key={group.dateLabel}>
              <div className="commit-date-label">{group.dateLabel}</div>
              <div className="commit-timeline-list">
                {group.items.map((commit) => (
                  <CommitTimelineItem commit={commit} key={commit.id} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function CommitTimelineItem({ commit }: { commit: CommitItem }) {
  const message = commit.message.split("\n", 1)[0] || "无提交信息";
  const committedDate = new Date(commit.committedAt);

  return (
    <article className="commit-timeline-item">
      <span className="commit-timeline-dot" aria-hidden="true" />
      <div className="min-w-0 pr-12 sm:pr-24">
        <a className="commit-message" href={commit.htmlUrl} rel="noreferrer" target="_blank">
          {message}
        </a>
        <div className="commit-meta">
          <span>{commit.repository.fullName}</span>
          {commit.branches[0] ? (
            <span className="inline-flex items-center gap-1">
              <GitBranch className="size-3.5" />
              {commit.branches[0]}
            </span>
          ) : null}
          <code>{commit.sha.slice(0, 7)}</code>
        </div>
      </div>
      <time className="commit-time" dateTime={commit.committedAt}>
        {committedDate.toLocaleTimeString("zh-CN", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })}
      </time>
    </article>
  );
}

function CommitSkeleton() {
  return (
    <>
      <section className="commit-panel commit-skeleton h-[390px]" aria-label="正在加载提交概览" />
      <section className="commit-panel commit-skeleton h-[620px]" aria-label="正在加载近期活动" />
    </>
  );
}

function EmptyCommitState() {
  return (
    <section className="commit-notice text-muted-foreground">暂时没有可显示的提交数据。</section>
  );
}

function buildCalendar(
  activity: CommitActivityDay[],
  rangeStart: string,
  rangeEnd: string,
): CalendarWeek[] {
  if (activity.length === 0 && !rangeStart && !rangeEnd) return [];
  const sorted = [...activity].sort((a, b) => a.date.localeCompare(b.date));
  const start = parseDate(rangeStart || sorted[0]?.date || rangeEnd);
  const end = parseDate(rangeEnd || sorted[sorted.length - 1]?.date || rangeStart);
  const data = new Map(sorted.map((day) => [day.date, day.count]));
  const max = Math.max(...sorted.map((day) => day.count), 1);
  const calendarStart = shiftDate(start, -start.getDay());
  const calendarEnd = shiftDate(end, 6 - end.getDay());
  const weeks: CalendarWeek[] = [];

  for (
    let weekStart = calendarStart;
    weekStart <= calendarEnd;
    weekStart = shiftDate(weekStart, 7)
  ) {
    const cells: CalendarCell[] = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = shiftDate(weekStart, dayIndex);
      const dateKey = toDateKey(date);
      const count = data.get(dateKey) ?? 0;
      const inRange = date >= start && date <= end;
      cells.push({
        date: dateKey,
        count,
        inRange,
        level: count === 0 ? 0 : Math.min(4, Math.ceil((count / max) * 4)),
      });
    }
    const firstMonthDay = cells.find((cell) => cell.date.endsWith("-01"));
    weeks.push({
      cells,
      monthLabel:
        firstMonthDay && weeks.length > 0 ? `${Number(firstMonthDay.date.slice(5, 7))}月` : null,
    });
  }
  return weeks;
}

function groupCommits(commits: CommitItem[]): CommitGroup[] {
  const groups = new Map<string, CommitItem[]>();
  for (const commit of [...commits].sort((a, b) => b.committedAt.localeCompare(a.committedAt))) {
    const dateKey = commit.committedAt.slice(0, 10);
    groups.set(dateKey, [...(groups.get(dateKey) ?? []), commit]);
  }
  return [...groups].map(([date, items]) => ({
    dateLabel: formatDayLabel(date),
    items,
  }));
}

function parseDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function shiftDate(date: Date, amount: number) {
  const shifted = new Date(date);
  shifted.setDate(shifted.getDate() + amount);
  return shifted;
}

function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function formatLongDate(value: string) {
  return parseDate(value).toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDayLabel(value: string) {
  const date = parseDate(value);
  const weekday = ["日", "一", "二", "三", "四", "五", "六"][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日周${weekday}`;
}

export { CommitPage };
