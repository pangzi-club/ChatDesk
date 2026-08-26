import type {
  MemoryBackfillPreview,
  MemoryItem,
  MemoryJob,
  MemoryOverview,
  MemorySettings,
  MemorySource,
  ModelConfig,
} from "@chatdesk/shared";
import {
  ChevronLeft,
  ChevronRight,
  History,
  ListRestart,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Trash2,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { chatSessionPath } from "@/lib/chat-routes";

type WorkspaceOption = { id: string; name: string };
const SOURCE_PAGE_SIZE = 20;

type Props = {
  overview: MemoryOverview;
  models: ModelConfig[];
  workspaces: WorkspaceOption[];
  sources: MemorySource[];
  jobs: MemoryJob[];
  backfill?: MemoryBackfillPreview;
  onSettingsChange: (value: Partial<MemorySettings>) => Promise<void>;
  onCreate: (value: Pick<MemoryItem, "content"> & Partial<MemoryItem>) => Promise<void>;
  onUpdate: (id: string, value: Partial<MemoryItem>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onConsolidate: () => Promise<void>;
  onBackfill: () => Promise<void>;
  onTabChange: () => void;
};

function formatDate(value?: string) {
  if (!value) return "尚未运行";
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

function statusLabel(status: MemoryJob["status"]) {
  return { queued: "等待中", running: "运行中", succeeded: "已完成", failed: "失败" }[status];
}

export function ChatMemorySettings({
  overview,
  models,
  workspaces,
  sources,
  jobs,
  backfill,
  onSettingsChange,
  onCreate,
  onUpdate,
  onDelete,
  onConsolidate,
  onBackfill,
  onTabChange,
}: Props) {
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<"global" | "workspace">("global");
  const [workspaceId, setWorkspaceId] = useState("");
  const [scopeFilter, setScopeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");
  const [editing, setEditing] = useState<MemoryItem | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [deleting, setDeleting] = useState<MemoryItem | null>(null);
  const [confirmBackfill, setConfirmBackfill] = useState(false);
  const [sourcePage, setSourcePage] = useState(1);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");

  const filteredItems = useMemo(
    () =>
      overview.items.filter(
        (item) =>
          (scopeFilter === "all" || item.scope === scopeFilter) &&
          (statusFilter === "all" || item.status === statusFilter),
      ),
    [overview.items, scopeFilter, statusFilter],
  );
  const sourceEntries = useMemo(
    () => [
      ...jobs
        .filter((job) => job.status !== "succeeded")
        .map((job) => ({ type: "job" as const, job })),
      ...[...sources]
        .sort((a, b) => b.generatedAt.localeCompare(a.generatedAt))
        .map((source) => ({ type: "source" as const, source })),
    ],
    [jobs, sources],
  );
  const sourcePageCount = Math.max(1, Math.ceil(sourceEntries.length / SOURCE_PAGE_SIZE));
  const currentSourcePage = Math.min(sourcePage, sourcePageCount);
  const paginatedSourceEntries = sourceEntries.slice(
    (currentSourcePage - 1) * SOURCE_PAGE_SIZE,
    currentSourcePage * SOURCE_PAGE_SIZE,
  );

  async function run(key: string, action: () => Promise<void>) {
    setPending(key);
    setError("");
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "操作失败，请稍后重试。");
    } finally {
      setPending("");
    }
  }

  async function addMemory() {
    const content = draft.trim();
    if (!content || (scope === "workspace" && !workspaceId)) return;
    await run("create", async () => {
      await onCreate({ content, scope, ...(scope === "workspace" ? { workspaceId } : {}) });
      setDraft("");
    });
  }

  return (
    <>
      <Tabs defaultValue="overview" onValueChange={onTabChange}>
        <TabsList variant="line">
          <TabsTrigger value="overview">概览</TabsTrigger>
          <TabsTrigger value="memories">记忆</TabsTrigger>
          <TabsTrigger value="sources">来源</TabsTrigger>
        </TabsList>

        {error ? <p className="mt-2 text-destructive text-xs">{error}</p> : null}

        <TabsContent className="space-y-5 pt-3" value="overview">
          <div className="divide-y divide-border rounded-md border border-border">
            <SettingSwitch
              checked={overview.settings.useMemories}
              description="将导览摘要和相关记忆提供给后续对话"
              id="memory-use"
              label="使用长期记忆"
              onChange={(value) =>
                void run("settings", () => onSettingsChange({ useMemories: value }))
              }
            />
            <SettingSwitch
              checked={overview.settings.generateMemories}
              description="成功完成的合格会话会在后台提取稳定事实"
              id="memory-generate"
              label="自动生成记忆"
              onChange={(value) =>
                void run("settings", () => onSettingsChange({ generateMemories: value }))
              }
            />
            <SettingSwitch
              checked={overview.settings.skipExternalContext}
              description="包含联网、MCP、浏览器或业务工具的会话默认不参与提取"
              id="memory-external"
              label="排除外部上下文"
              onChange={(value) =>
                void run("settings", () => onSettingsChange({ skipExternalContext: value }))
              }
            />
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <ModelSelect
              label="提取模型"
              models={models}
              value={overview.settings.extractionModelId}
              onChange={(value) =>
                void run("settings", () =>
                  onSettingsChange({ extractionModelId: value === "inherit" ? "" : value }),
                )
              }
            />
            <ModelSelect
              label="整合模型"
              models={models}
              value={overview.settings.consolidationModelId}
              onChange={(value) =>
                void run("settings", () =>
                  onSettingsChange({ consolidationModelId: value === "inherit" ? "" : value }),
                )
              }
            />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border px-3 py-2.5">
            <div>
              <Label htmlFor="memory-retention">未使用归档期限</Label>
              <p className="mt-0.5 text-muted-foreground text-xs">
                自动记忆超过此期限未召回且没有新证据时归档
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Input
                className="h-8 w-24"
                defaultValue={overview.settings.maxUnusedDays}
                id="memory-retention"
                key={overview.settings.maxUnusedDays}
                max={3650}
                min={1}
                type="number"
                onBlur={(event) => {
                  const value = Number(event.currentTarget.value);
                  if (
                    Number.isFinite(value) &&
                    value >= 1 &&
                    value <= 3650 &&
                    value !== overview.settings.maxUnusedDays
                  ) {
                    void run("settings", () =>
                      onSettingsChange({ maxUnusedDays: Math.round(value) }),
                    );
                  }
                }}
              />
              <span className="text-muted-foreground text-xs">天</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
            <Stat
              label="活动记忆"
              value={overview.items.filter((item) => item.status === "active").length}
            />
            <Stat label="等待任务" value={overview.pipeline.queuedJobs} />
            <Stat label="运行任务" value={overview.pipeline.runningJobs} />
            <Stat label="失败任务" value={overview.pipeline.failedJobs} />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 border-border border-t pt-4">
            <div className="text-xs">
              <p>最近提取：{formatDate(overview.pipeline.lastExtractedAt)}</p>
              <p className="mt-1 text-muted-foreground">
                最近整合：{formatDate(overview.pipeline.lastConsolidatedAt)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={pending === "consolidate"}
                size="sm"
                variant="outline"
                onClick={() => void run("consolidate", onConsolidate)}
              >
                <ListRestart className="size-3.5" />
                立即整合
              </Button>
              <Button
                disabled={!backfill?.candidateCount || pending === "backfill"}
                size="sm"
                variant="outline"
                onClick={() => setConfirmBackfill(true)}
              >
                <History className="size-3.5" />
                回填 {backfill?.candidateCount ?? 0} 个会话
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent className="space-y-4 pt-3" value="memories">
          <div className="space-y-2 border-border border-b pb-4">
            <Label htmlFor="memory-draft">添加固定记忆</Label>
            <Textarea
              id="memory-draft"
              placeholder="例如：用户偏好简洁中文回复"
              rows={2}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
            <div className="flex flex-wrap items-center gap-2">
              <Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
                <SelectTrigger aria-label="记忆范围" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="global">全局</SelectItem>
                  <SelectItem value="workspace">Workspace</SelectItem>
                </SelectContent>
              </Select>
              {scope === "workspace" ? (
                <Select value={workspaceId} onValueChange={setWorkspaceId}>
                  <SelectTrigger aria-label="选择 Workspace" className="min-w-44" size="sm">
                    <SelectValue placeholder="选择 Workspace" />
                  </SelectTrigger>
                  <SelectContent>
                    {workspaces
                      .filter((item) => item.id !== "default")
                      .map((item) => (
                        <SelectItem key={item.id} value={item.id}>
                          {item.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              ) : null}
              <Button
                disabled={
                  !draft.trim() || (scope === "workspace" && !workspaceId) || pending === "create"
                }
                size="sm"
                onClick={() => void addMemory()}
              >
                <Plus className="size-3.5" />
                添加
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <FilterSelect
                label="范围"
                value={scopeFilter}
                values={["all", "global", "workspace"]}
                onChange={setScopeFilter}
              />
              <FilterSelect
                label="状态"
                value={statusFilter}
                values={["active", "archived", "all"]}
                onChange={setStatusFilter}
              />
            </div>
            <span className="text-muted-foreground text-xs">{filteredItems.length} 条</span>
          </div>

          <div className="divide-y divide-border rounded-md border border-border">
            {filteredItems.length === 0 ? (
              <p className="px-4 py-10 text-center text-muted-foreground text-sm">
                没有符合条件的记忆
              </p>
            ) : (
              filteredItems.map((item) => (
                <div className="px-3 py-3" key={item.id}>
                  {editing?.id === item.id ? (
                    <div className="space-y-2">
                      <Textarea
                        value={editingContent}
                        onChange={(event) => setEditingContent(event.target.value)}
                      />
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          取消
                        </Button>
                        <Button
                          size="sm"
                          onClick={() =>
                            void run("edit", async () => {
                              await onUpdate(item.id, { content: editingContent });
                              setEditing(null);
                            })
                          }
                        >
                          保存
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-relaxed">{item.content}</p>
                        <div className="mt-2 flex flex-wrap gap-1.5 text-muted-foreground text-[11px]">
                          <Badge variant="outline">
                            {item.scope === "global" ? "全局" : "Workspace"}
                          </Badge>
                          <span>{item.category}</span>
                          <span>·</span>
                          <span>使用 {item.usageCount} 次</span>
                          <span>·</span>
                          <span>更新 {formatDate(item.updatedAt)}</span>
                        </div>
                        {item.evidence[0] ? (
                          <p className="mt-2 line-clamp-2 text-muted-foreground text-xs">
                            来源：{item.evidence[0].excerpt}
                          </p>
                        ) : null}
                        {item.archiveReason ? (
                          <p className="mt-1 text-muted-foreground text-xs">
                            归档原因：{item.archiveReason}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          aria-label={item.pinned ? "取消固定" : "固定记忆"}
                          size="icon"
                          variant="ghost"
                          onClick={() =>
                            void run("pin", () => onUpdate(item.id, { pinned: !item.pinned }))
                          }
                        >
                          {item.pinned ? (
                            <PinOff className="size-3.5" />
                          ) : (
                            <Pin className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          aria-label="编辑记忆"
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setEditing(item);
                            setEditingContent(item.content);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          aria-label="删除记忆"
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleting(item)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </TabsContent>

        <TabsContent className="pt-3" value="sources">
          <div className="divide-y divide-border rounded-md border border-border">
            {sourceEntries.length === 0 ? (
              <p className="px-4 py-10 text-center text-muted-foreground text-sm">尚无提取来源</p>
            ) : (
              <>
                {paginatedSourceEntries.map((entry) =>
                  entry.type === "job" ? (
                    <div
                      className="flex items-start justify-between gap-3 px-3 py-3"
                      key={`job-${entry.job.id}`}
                    >
                      <div className="min-w-0">
                        <p className="font-medium text-sm">
                          {entry.job.kind === "extract" ? "会话提取" : "全局整合"}
                        </p>
                        <p className="mt-1 truncate text-muted-foreground text-xs">
                          {entry.job.sessionId ?? entry.job.id}
                        </p>
                        {entry.job.error ? (
                          <p className="mt-1 text-destructive text-xs">{entry.job.error}</p>
                        ) : null}
                      </div>
                      <Badge variant="outline">{statusLabel(entry.job.status)}</Badge>
                    </div>
                  ) : (
                    <div className="px-3 py-3" key={`source-${entry.source.sessionId}`}>
                      <div className="flex items-center justify-between gap-3">
                        <Link
                          className="truncate font-medium text-primary text-sm hover:underline"
                          to={chatSessionPath(entry.source.sessionId)}
                        >
                          {entry.source.sessionTitle}
                        </Link>
                        <span className="shrink-0 text-muted-foreground text-xs">
                          {entry.source.facts.length} 条
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground text-xs">
                        {entry.source.summary || "未提取到稳定摘要"}
                      </p>
                      <p className="mt-1 text-muted-foreground text-[11px]">
                        {formatDate(entry.source.generatedAt)} · {entry.source.sessionId}
                      </p>
                    </div>
                  ),
                )}
                <div className="flex min-h-10 items-center justify-between gap-3 px-3 py-1.5">
                  <span className="text-muted-foreground text-xs">
                    第 {currentSourcePage} / {sourcePageCount} 页 · 共 {sourceEntries.length} 条
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      aria-label="上一页"
                      className="size-7"
                      disabled={currentSourcePage <= 1}
                      size="icon"
                      title="上一页"
                      variant="ghost"
                      onClick={() => setSourcePage(Math.max(1, currentSourcePage - 1))}
                    >
                      <ChevronLeft className="size-3.5" />
                    </Button>
                    <Button
                      aria-label="下一页"
                      className="size-7"
                      disabled={currentSourcePage >= sourcePageCount}
                      size="icon"
                      title="下一页"
                      variant="ghost"
                      onClick={() =>
                        setSourcePage(Math.min(sourcePageCount, currentSourcePage + 1))
                      }
                    >
                      <ChevronRight className="size-3.5" />
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除这条记忆？</AlertDialogTitle>
            <AlertDialogDescription>删除后无法恢复，来源会话不会受到影响。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() =>
                deleting &&
                void run("delete", async () => {
                  await onDelete(deleting.id);
                  setDeleting(null);
                })
              }
            >
              删除
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmBackfill} onOpenChange={setConfirmBackfill}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>回填历史会话？</AlertDialogTitle>
            <AlertDialogDescription>
              将为 {backfill?.candidateCount ?? 0} 个合格会话创建后台模型任务，并计入 AI 用量。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() =>
                void run("backfill", async () => {
                  await onBackfill();
                  setConfirmBackfill(false);
                })
              }
            >
              开始回填
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SettingSwitch({
  id,
  label,
  description,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-3 py-3">
      <div>
        <Label htmlFor={id}>{label}</Label>
        <p className="mt-1 text-muted-foreground text-xs">{description}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ModelSelect({
  label,
  models,
  value,
  onChange,
}: {
  label: string;
  models: ModelConfig[];
  value?: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Select value={value ?? "inherit"} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="inherit">继承默认模型</SelectItem>
          {models.map((model) => (
            <SelectItem key={model.id} value={model.id}>
              {model.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-background px-3 py-3">
      <p className="text-muted-foreground text-xs">{label}</p>
      <p className="mt-1 font-semibold text-lg">{value}</p>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  values,
  onChange,
}: {
  label: string;
  value: string;
  values: string[];
  onChange: (value: string) => void;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {values.map((item) => (
          <SelectItem key={item} value={item}>
            {item === "all"
              ? "全部"
              : item === "global"
                ? "全局"
                : item === "workspace"
                  ? "Workspace"
                  : item === "active"
                    ? "活动"
                    : "归档"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
