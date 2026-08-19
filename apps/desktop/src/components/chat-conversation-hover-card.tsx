import { useQuery } from "@tanstack/react-query";
import { CalendarClock, FolderGit2, GitBranch } from "lucide-react";
import type { ReactElement } from "react";
import { useState } from "react";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { loadServerWorkspaceGit } from "@/lib/chat-server";
import type { ChatIndexItem } from "@/lib/chat-store";
import { type WorkspaceGitInfo, workspaceGitQueryKey } from "@/lib/workspaces";

type ChatConversationHoverCardProps = {
  children: ReactElement;
  session: Pick<ChatIndexItem, "createdAt" | "title">;
  workspaceId: string;
  workspaceLabel: string;
  cwd?: string;
};

export function formatConversationCreatedAt(value: string, now = Date.now()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  const elapsedSeconds = Math.max(0, Math.floor((now - date.getTime()) / 1000));
  if (elapsedSeconds < 60) return "刚刚";
  if (elapsedSeconds < 60 * 60) return `${Math.floor(elapsedSeconds / 60)}m`;
  if (elapsedSeconds < 24 * 60 * 60) return `${Math.floor(elapsedSeconds / (60 * 60))}h`;
  if (elapsedSeconds < 30 * 24 * 60 * 60) return `${Math.floor(elapsedSeconds / (24 * 60 * 60))}d`;
  if (elapsedSeconds < 365 * 24 * 60 * 60) {
    return `${Math.floor(elapsedSeconds / (30 * 24 * 60 * 60))}mo`;
  }
  return `${Math.floor(elapsedSeconds / (365 * 24 * 60 * 60))}y`;
}

export function ChatConversationHoverCard({
  children,
  session,
  workspaceId,
  workspaceLabel,
  cwd,
}: ChatConversationHoverCardProps) {
  const [open, setOpen] = useState(false);
  const gitQuery = useQuery({
    queryKey: workspaceGitQueryKey(workspaceId, cwd),
    queryFn: () => loadServerWorkspaceGit(workspaceId, cwd) as Promise<WorkspaceGitInfo>,
    enabled: open,
    staleTime: 15_000,
    retry: false,
  });

  let branch = "无分支";
  if (gitQuery.isPending) branch = "正在读取...";
  else if (gitQuery.isError) branch = "无法读取";
  else if (gitQuery.data?.isRepository) branch = gitQuery.data.status?.branch ?? "HEAD";

  return (
    <HoverCard closeDelay={120} onOpenChange={setOpen} openDelay={300}>
      <HoverCardTrigger asChild>{children}</HoverCardTrigger>
      <HoverCardContent
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] p-0"
        collisionPadding={12}
        side="right"
        sideOffset={10}
      >
        <div className="border-b px-4 py-3">
          <p className="line-clamp-2 text-[14px] leading-5 font-semibold" title={session.title}>
            {session.title}
          </p>
        </div>
        <dl className="grid gap-2.5 px-4 py-3 text-[12px]">
          <div className="grid grid-cols-[16px_72px_minmax(0,1fr)] items-center gap-2">
            <CalendarClock className="size-4 text-muted-foreground" />
            <dt className="text-muted-foreground">创建时间</dt>
            <dd className="truncate text-right font-medium tabular-nums">
              {formatConversationCreatedAt(session.createdAt)}
            </dd>
          </div>
          <div className="grid grid-cols-[16px_72px_minmax(0,1fr)] items-center gap-2">
            <FolderGit2 className="size-4 text-muted-foreground" />
            <dt className="text-muted-foreground">Workspace</dt>
            <dd className="truncate text-right font-medium" title={workspaceLabel}>
              {workspaceLabel}
            </dd>
          </div>
          <div className="grid grid-cols-[16px_72px_minmax(0,1fr)] items-center gap-2">
            <GitBranch className="size-4 text-muted-foreground" />
            <dt className="text-muted-foreground">分支</dt>
            <dd className="truncate text-right font-medium" title={branch}>
              {branch}
            </dd>
          </div>
        </dl>
      </HoverCardContent>
    </HoverCard>
  );
}
