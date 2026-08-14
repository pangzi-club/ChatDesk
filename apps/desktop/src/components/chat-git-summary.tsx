import type { WorkspaceGitSummary } from "@chatdesk/shared";
import { GitCommitHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Composer 上方的 Git 改动摘要状态按钮，点击打开首个改动文件的 diff。 */
export function ChatGitSummary({
  summary,
  onOpenDiff,
}: {
  summary: WorkspaceGitSummary;
  onOpenDiff: () => void | Promise<void>;
}) {
  const branch = summary.branch ?? "HEAD";
  return (
    <Button
      aria-label={`查看 Git 改动（${branch}）`}
      className="chat-git-summary-float"
      onClick={() => void onOpenDiff()}
      title={`查看 Git 改动（${branch}）`}
      type="button"
      variant="outline"
    >
      <GitCommitHorizontal aria-hidden="true" className="size-3.5" />
      <span className="chat-git-summary-branch">{branch}</span>
      <span className="chat-git-summary-add">+{summary.insertions}</span>
      <span className="chat-git-summary-delete">-{summary.deletions}</span>
      <span className="chat-git-summary-files">· {summary.filesChanged} 个文件已修改</span>
    </Button>
  );
}
