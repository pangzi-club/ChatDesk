import { useQuery } from "@tanstack/react-query";
import { Check, CircleAlert, Clock3, ShieldX } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type ChatServerReviewerLog, loadChatServerReviewerLogs } from "@/lib/chat-server";

type ChatReviewerDialogProps = {
  open: boolean;
  sessionId: string;
  onOpenChange: (open: boolean) => void;
};

const decisionLabels: Record<ChatServerReviewerLog["decision"], string> = {
  approve: "Reviewer 已批准",
  deny: "Reviewer 已拒绝",
  "user-approval": "已回退人工确认",
};

const reasonLabels: Record<string, string> = {
  "external-path": "外部路径",
  "external-cwd": "外部工作目录",
  network: "网络命令",
  "ambiguous-shell": "无法可靠判断的 Shell",
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function DecisionIcon({ decision }: { decision: ChatServerReviewerLog["decision"] }) {
  if (decision === "approve") return <Check className="size-3.5" />;
  if (decision === "deny") return <ShieldX className="size-3.5" />;
  return <CircleAlert className="size-3.5" />;
}

function decisionClassName(decision: ChatServerReviewerLog["decision"]) {
  if (decision === "approve") return "text-emerald-600 dark:text-emerald-400";
  if (decision === "deny") return "text-destructive";
  return "text-amber-600 dark:text-amber-400";
}

function ReviewEntry({ entry }: { entry: ChatServerReviewerLog }) {
  return (
    <article className="rounded-md border border-border px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div
          className={`flex items-center gap-1.5 font-medium text-xs ${decisionClassName(entry.decision)}`}
        >
          <DecisionIcon decision={entry.decision} />
          {decisionLabels[entry.decision]}
        </div>
        <time
          className="flex items-center gap-1 text-[11px] text-muted-foreground"
          dateTime={entry.timestamp}
        >
          <Clock3 className="size-3" />
          {formatTimestamp(entry.timestamp)}
        </time>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span className="font-medium">{entry.toolName || "未知工具"}</span>
        {entry.modelId ? (
          <span className="text-muted-foreground">模型：{entry.modelId}</span>
        ) : null}
        {entry.durationMs !== undefined ? (
          <span className="text-muted-foreground">耗时：{entry.durationMs} ms</span>
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {entry.reasons.map((reason) => (
          <span
            className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
            key={reason}
          >
            {reasonLabels[reason] ?? reason}
          </span>
        ))}
      </div>
      {entry.rationale || entry.reason || entry.error ? (
        <p className="mt-2 whitespace-pre-wrap break-words text-muted-foreground text-xs leading-5">
          {entry.rationale || entry.reason || entry.error}
        </p>
      ) : null}
    </article>
  );
}

export function ChatReviewerDialog({ open, sessionId, onOpenChange }: ChatReviewerDialogProps) {
  const query = useQuery<ChatServerReviewerLog[]>({
    queryKey: ["chat-reviewer-logs", sessionId],
    queryFn: () => loadChatServerReviewerLogs(sessionId),
    enabled: open && Boolean(sessionId),
    refetchOnMount: "always",
    refetchInterval: open ? 2_000 : false,
  });
  const entries = query.data ?? [];

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Reviewer 记录</DialogTitle>
          <DialogDescription>
            仅显示当前对话。Reviewer 只处理越过 workspace 或 Seatbelt 的请求；失败时会回退人工确认。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-4 min-h-0 flex-1 overflow-y-auto pr-1">
          {query.isLoading ? (
            <div className="space-y-3">
              <div className="h-20 animate-pulse rounded-md bg-accent" />
              <div className="h-20 animate-pulse rounded-md bg-accent" />
            </div>
          ) : query.isError ? (
            <p className="py-10 text-center text-destructive text-xs">Reviewer 记录加载失败。</p>
          ) : entries.length === 0 ? (
            <p className="py-10 text-center text-muted-foreground text-xs">暂无 Reviewer 记录。</p>
          ) : (
            <div className="space-y-3">
              {entries.map((entry) => (
                <ReviewEntry entry={entry} key={entry.id} />
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
