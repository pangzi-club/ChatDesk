import { useMutation } from "@tanstack/react-query";
import {
  Check,
  ChevronDown,
  CloudUpload,
  GitBranch,
  LoaderCircle,
  Minus,
  Plus,
} from "lucide-react";
import { type KeyboardEvent, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { commitServerWorkspaceGit, pushServerWorkspaceGit } from "@/lib/chat-server";

type GitCommitDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  cwd?: string;
  branch?: string | null;
  hasChanges?: boolean;
  canPush?: boolean;
  insertions?: number;
  deletions?: number;
  filesChanged?: number;
  onSuccess?: () => void;
};

type GitCommitAction = "cancel" | "commit" | "commit-push" | "push";

const ACTION_ORDER: GitCommitAction[] = ["cancel", "commit", "commit-push", "push"];

export function GitCommitDialog({
  open,
  onOpenChange,
  workspaceId,
  cwd,
  branch,
  hasChanges = true,
  canPush = false,
  insertions = 0,
  deletions = 0,
  filesChanged = 0,
  onSuccess,
}: GitCommitDialogProps) {
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<GitCommitAction>("commit");
  const mutation = useMutation({
    mutationFn: (action: "commit" | "push" | "commit-push") => {
      if (action === "push") return pushServerWorkspaceGit(workspaceId, cwd);
      return commitServerWorkspaceGit(workspaceId, {
        message,
        push: action === "commit-push",
        cwd,
      });
    },
    onSuccess: () => {
      setMessage("");
      setError(null);
      onOpenChange(false);
      onSuccess?.();
    },
    onError: (value) => setError(value instanceof Error ? value.message : String(value)),
  });

  useEffect(() => {
    if (!open) return;
    setError(null);
    setSelectedAction(hasChanges ? "commit" : canPush ? "push" : "cancel");
  }, [canPush, hasChanges, open]);

  const run = (action: "commit" | "push" | "commit-push") => mutation.mutate(action);
  const isActionEnabled = (action: GitCommitAction) =>
    action === "cancel" || ((action === "push" ? canPush : hasChanges) && !mutation.isPending);
  const selectAction = (action: GitCommitAction) => {
    if (!isActionEnabled(action)) return;
    setSelectedAction(action);
    document.querySelector<HTMLButtonElement>(`[data-git-action="${action}"]`)?.focus();
  };
  const moveSelection = (direction: 1 | -1) => {
    const enabled = ACTION_ORDER.filter(isActionEnabled);
    const currentIndex = enabled.indexOf(selectedAction);
    const nextIndex =
      currentIndex < 0 ? 0 : (currentIndex + direction + enabled.length) % enabled.length;
    selectAction(enabled[nextIndex] ?? "cancel");
  };
  const handleKeyDown = (event: KeyboardEvent) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      if (selectedAction === "cancel") onOpenChange(false);
      else if (isActionEnabled(selectedAction)) run(selectedAction);
      return;
    }
    if (event.target instanceof HTMLTextAreaElement) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(-1);
    }
  };
  const actionButton = (
    action: GitCommitAction,
    label: string,
    onClick: () => void,
    disabled = false,
  ) => (
    <Button
      aria-pressed={selectedAction === action}
      className={`git-commit-action ${selectedAction === action ? "is-selected" : ""}`}
      disabled={disabled || mutation.isPending}
      onClick={() => {
        setSelectedAction(action);
        onClick();
      }}
      onFocus={() => setSelectedAction(action)}
      data-git-action={action}
      type="button"
      variant="ghost"
    >
      <span className="git-commit-action-icon">
        {mutation.isPending && selectedAction === action ? (
          <LoaderCircle className="size-5 animate-spin" />
        ) : action === "commit" ? (
          <span className="git-commit-dot" />
        ) : (
          <CloudUpload className="size-5" />
        )}
      </span>
      <span className="git-commit-action-label">{label}</span>
      {selectedAction === action && action !== "cancel" ? (
        <span className="git-commit-shortcut">
          <span>⌘</span>
          <span>↵</span>
        </span>
      ) : null}
    </Button>
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!mutation.isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="git-commit-dialog sm:max-w-[520px]" onKeyDown={handleKeyDown}>
        <DialogHeader className="git-commit-dialog-header">
          <DialogTitle className="sr-only">提交或推送</DialogTitle>
          <DialogDescription className="sr-only">
            {branch ? `当前分支：${branch}。` : "提交当前 workspace 的改动。"}
          </DialogDescription>
          <div className="git-commit-branch">
            <GitBranch className="size-6" />
            <span>{branch ?? "HEAD"}</span>
            <ChevronDown className="size-5 text-muted-foreground" />
          </div>
        </DialogHeader>
        <Textarea
          autoFocus
          className="git-commit-message"
          disabled={mutation.isPending}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="提交信息（留空将自动生成）"
          value={message}
        />
        {error ? <p className="text-destructive text-sm">{error}</p> : null}
        <div className="git-commit-scope">
          <span className="git-commit-scope-check">
            <Check className="size-4" />
          </span>
          <span className="git-commit-scope-label">
            包含未暂存的更改
            <span className="git-commit-scope-count">{filesChanged || "全部"} 个文件</span>
          </span>
          <span className="git-commit-stats">
            <span className="text-emerald-400">
              <Plus className="inline size-4" />
              {insertions}
            </span>
            <span className="text-rose-400">
              <Minus className="inline size-4" />
              {deletions}
            </span>
          </span>
        </div>
        <DialogFooter className="git-commit-actions">
          {actionButton("commit", "提交", () => run("commit"), !hasChanges)}
          {actionButton("commit-push", "提交并推送", () => run("commit-push"), !hasChanges)}
          {actionButton("push", "推送", () => run("push"), !canPush)}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
