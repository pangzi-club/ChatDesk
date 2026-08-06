import { useQuery } from "@tanstack/react-query";
import { Import, LoaderCircle } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import {
  type ArchiveIndexItem,
  archiveKey,
  type ImportedArchiveSource,
  readImportTextFile,
  type ScannedSession,
  saveArchiveSession,
  scanClaudeSessions,
  scanCodexSessions,
  sourceLabel,
} from "@/lib/chat-archive";
import { parseClaudeCodeSession } from "@/lib/importers/claude-code";
import { parseCodexRollout } from "@/lib/importers/codex";

type HistoryImportDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  archiveIndex: ArchiveIndexItem[];
  onImported: () => void;
};

type ImportSummary = {
  created: number;
  overwritten: number;
  failed: Array<{ title: string; error: string }>;
  cancelled: boolean;
};

function selectionKey(item: ScannedSession) {
  return archiveKey(item.source, item.externalId);
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value?: string | null) {
  if (!value) return "时间未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-CN");
}

function HistoryImportDialog({
  open,
  onOpenChange,
  archiveIndex,
  onImported,
}: HistoryImportDialogProps) {
  const importedKeys = useMemo(
    () => new Set(archiveIndex.map((item) => archiveKey(item.source, item.externalId))),
    [archiveIndex],
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: "" });
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const cancelRef = useRef(false);

  const scanQuery = useQuery({
    queryKey: ["history-scan"],
    queryFn: async () => {
      const [codex, claude] = await Promise.all([scanCodexSessions(), scanClaudeSessions()]);
      return [...codex, ...claude];
    },
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setImporting(false);
      setProgress({ done: 0, total: 0, current: "" });
      setSummary(null);
      cancelRef.current = false;
    }
  }, [open]);

  const scanned = scanQuery.data ?? [];
  const grouped = useMemo(() => {
    const groups: Record<ImportedArchiveSource, ScannedSession[]> = {
      codex: [],
      "claude-code": [],
    };
    for (const item of scanned) {
      groups[item.source].push(item);
    }
    return groups;
  }, [scanned]);

  function toggle(item: ScannedSession, checked: boolean) {
    const key = selectionKey(item);
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function selectAll(source?: ImportedArchiveSource) {
    const items = source ? grouped[source] : scanned;
    setSelected((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        next.add(selectionKey(item));
      }
      return next;
    });
  }

  async function runImport() {
    const targets = scanned.filter((item) => selected.has(selectionKey(item)));
    if (targets.length === 0) return;

    cancelRef.current = false;
    setImporting(true);
    setSummary(null);
    setProgress({ done: 0, total: targets.length, current: targets[0]?.title || "准备导入…" });

    let created = 0;
    let overwritten = 0;
    const failed: ImportSummary["failed"] = [];

    for (let index = 0; index < targets.length; index += 1) {
      if (cancelRef.current) break;
      const item = targets[index];
      const title = item.title?.trim() || item.externalId;
      setProgress({ done: index, total: targets.length, current: title });

      try {
        const contents = await readImportTextFile(item.sourcePath);
        const session =
          item.source === "codex"
            ? parseCodexRollout(contents, {
                externalId: item.externalId,
                sourcePath: item.sourcePath,
                titleHint: item.title,
              })
            : parseClaudeCodeSession(contents, {
                externalId: item.externalId,
                sourcePath: item.sourcePath,
                titleHint: item.title,
                cwdHint: item.cwd,
              });
        const result = await saveArchiveSession(session);
        if (result.overwritten) overwritten += 1;
        else created += 1;
      } catch (error) {
        failed.push({
          title,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    setProgress((prev) => ({ ...prev, done: targets.length, current: "完成" }));
    setSummary({
      created,
      overwritten,
      failed,
      cancelled: cancelRef.current,
    });
    setImporting(false);
    if (created + overwritten > 0) onImported();
  }

  const progressValue =
    progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  const overwriteSelectedCount = [...selected].filter((key) => importedKeys.has(key)).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (importing) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[85vh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-border border-b px-6 py-5">
          <DialogTitle>导入对话历史</DialogTitle>
          <DialogDescription>
            自动扫描 ~/.codex 与 ~/.claude。已导入项可再次勾选，将覆盖本地归档并刷新 token 用量。
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {scanQuery.isPending ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <LoaderCircle className="size-4 animate-spin" />
              正在扫描本地会话…
            </div>
          ) : null}
          {scanQuery.isError ? (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
              扫描失败：
              {scanQuery.error instanceof Error ? scanQuery.error.message : String(scanQuery.error)}
              。请确认已安装 Codex / Claude Code，且目录存在。
            </p>
          ) : null}
          {!scanQuery.isPending && !scanQuery.isError && scanned.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/40 px-4 py-3 text-muted-foreground text-sm">
              未发现可导入会话。默认路径：~/.codex/sessions、~/.claude/projects。
            </p>
          ) : null}

          {(["codex", "claude-code"] as const).map((source) => {
            const items = grouped[source];
            if (items.length === 0) return null;
            return (
              <section key={source} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="font-medium text-sm">
                    {sourceLabel(source)}
                    <span className="ml-2 text-muted-foreground">{items.length}</span>
                  </h3>
                  <Button
                    disabled={importing}
                    onClick={() => selectAll(source)}
                    size="sm"
                    type="button"
                    variant="ghost"
                  >
                    全选
                  </Button>
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="divide-y divide-border">
                    {items.map((item) => {
                      const key = selectionKey(item);
                      const already = importedKeys.has(key);
                      const checked = selected.has(key);
                      return (
                        <label
                          key={key}
                          className="flex cursor-pointer items-start gap-3 px-4 py-3 hover:bg-accent/30 has-disabled:cursor-not-allowed has-disabled:opacity-60"
                        >
                          <Checkbox
                            checked={checked}
                            className="mt-0.5"
                            disabled={importing}
                            onCheckedChange={(value) => toggle(item, value === true)}
                          />
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="font-medium text-sm">
                                {item.title?.trim() || item.externalId}
                              </p>
                              {already ? (
                                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground text-xs">
                                  已导入 · 将覆盖
                                </span>
                              ) : null}
                            </div>
                            <p className="mt-1 text-muted-foreground text-xs">
                              {formatTime(item.updatedAt)} · {formatBytes(item.size)}
                            </p>
                            {item.cwd ? (
                              <p className="mt-1 break-all font-mono text-muted-foreground text-xs">
                                {item.cwd}
                              </p>
                            ) : null}
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              </section>
            );
          })}

          {importing || summary ? (
            <section className="space-y-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate text-muted-foreground">{progress.current}</span>
                <span className="shrink-0 tabular-nums">
                  {progress.done}/{progress.total}
                </span>
              </div>
              <Progress value={progressValue} />
              {summary ? (
                <div className="space-y-2 text-sm">
                  <p>
                    新建 {summary.created} · 覆盖 {summary.overwritten} · 失败{" "}
                    {summary.failed.length}
                    {summary.cancelled ? " · 已取消" : ""}
                  </p>
                  {summary.failed.length > 0 ? (
                    <details>
                      <summary className="cursor-pointer text-destructive">查看失败详情</summary>
                      <ul className="mt-2 space-y-1 text-muted-foreground text-xs">
                        {summary.failed.map((item) => (
                          <li key={`${item.title}-${item.error}`}>
                            {item.title}: {item.error}
                          </li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <DialogFooter className="border-border border-t px-6 py-4">
          {importing ? (
            <Button
              onClick={() => {
                cancelRef.current = true;
              }}
              type="button"
              variant="outline"
            >
              取消导入
            </Button>
          ) : (
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">
              关闭
            </Button>
          )}
          <Button
            disabled={importing || selected.size === 0}
            onClick={() => void runImport()}
            type="button"
          >
            <Import className="size-4" />
            {overwriteSelectedCount > 0
              ? `导入选中（${selected.size}，含覆盖 ${overwriteSelectedCount}）`
              : `导入选中（${selected.size}）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { HistoryImportDialog };
