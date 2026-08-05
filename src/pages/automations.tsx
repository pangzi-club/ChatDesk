import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Clock3, Edit3, ListChecks, MoreHorizontal, Pause, Play, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  type AutomationTask,
  type AutomationTaskType,
  automationTaskTypeLabels,
  loadAutomationTasks,
  saveAutomationTasks,
} from "@/lib/automation";
import { appendSystemLog } from "@/lib/system-log";

const AUTOMATION_QUERY_KEY = ["automation-tasks"];

type TaskDraft = {
  name: string;
  type: AutomationTaskType;
  intervalMinutes: string;
  enabled: boolean;
};

const emptyDraft: TaskDraft = {
  name: "",
  type: "log-current-time",
  intervalMinutes: "5",
  enabled: true,
};

function AutomationsPage() {
  const queryClient = useQueryClient();
  const tasksQuery = useQuery({ queryKey: AUTOMATION_QUERY_KEY, queryFn: loadAutomationTasks });
  const saveMutation = useMutation({
    mutationFn: saveAutomationTasks,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AUTOMATION_QUERY_KEY }),
  });
  const tasks = tasksQuery.data ?? [];
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AutomationTask | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);

  useEffect(() => {
    const timers = tasks
      .filter((task) => task.enabled)
      .map((task) =>
        window.setInterval(() => {
          if (task.type === "log-current-time") {
            void appendSystemLog({
              level: "info",
              source: `自动化 · ${task.name}`,
              message: `当前时间：${new Intl.DateTimeFormat("zh-CN", { dateStyle: "short", timeStyle: "medium" }).format(new Date())}`,
            }).catch(() => undefined);
          }
        }, task.intervalMinutes * 60_000),
      );

    return () => {
      timers.forEach((timer) => {
        window.clearInterval(timer);
      });
    };
  }, [tasks]);

  const activeCount = useMemo(() => tasks.filter((task) => task.enabled).length, [tasks]);

  function openCreate() {
    setEditingTask(null);
    setDraft(emptyDraft);
    setIsEditorOpen(true);
  }

  function openEdit(task: AutomationTask) {
    setEditingTask(task);
    setDraft({
      name: task.name,
      type: task.type,
      intervalMinutes: String(task.intervalMinutes),
      enabled: task.enabled,
    });
    setIsEditorOpen(true);
  }

  function closeEditor() {
    setIsEditorOpen(false);
    setEditingTask(null);
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.name.trim();
    const intervalMinutes = Number(draft.intervalMinutes);
    if (!name || !Number.isFinite(intervalMinutes) || intervalMinutes < 1) return;

    const now = new Date().toISOString();
    const nextTask: AutomationTask = editingTask
      ? {
          ...editingTask,
          name,
          type: draft.type,
          intervalMinutes,
          enabled: draft.enabled,
          updatedAt: now,
        }
      : {
          id: crypto.randomUUID(),
          name,
          type: draft.type,
          intervalMinutes,
          enabled: draft.enabled,
          createdAt: now,
          updatedAt: now,
        };
    const nextTasks = editingTask
      ? tasks.map((task) => (task.id === editingTask.id ? nextTask : task))
      : [nextTask, ...tasks];
    await saveMutation.mutateAsync(nextTasks);
    closeEditor();
  }

  async function deleteTask(task: AutomationTask) {
    if (!window.confirm(`确定删除“${task.name}”？`)) return;
    await saveMutation.mutateAsync(tasks.filter((item) => item.id !== task.id));
  }

  async function toggleTask(task: AutomationTask) {
    const now = new Date().toISOString();
    await saveMutation.mutateAsync(
      tasks.map((item) =>
        item.id === task.id ? { ...item, enabled: !item.enabled, updatedAt: now } : item,
      ),
    );
  }

  return (
    <main className="min-h-full bg-background px-5 pt-14 pb-10 text-foreground sm:px-8 lg:px-12">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-end justify-between gap-5 border-border border-b pb-6">
          <div>
            <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.18em]">
              Workspace / Automation
            </p>
            <h1 className="mt-2 font-semibold text-3xl tracking-tight">自动化</h1>
            <p className="mt-2 max-w-xl text-muted-foreground text-sm">
              让重复的小事按固定节奏运行，执行记录会写入系统日志。
            </p>
          </div>
          <Button onClick={openCreate} type="button">
            <Plus className="size-4" /> 新增自动任务
          </Button>
        </header>

        <section className="grid gap-3 py-6 sm:grid-cols-3" aria-label="自动化概览">
          <Stat label="全部任务" value={tasks.length} icon={<ListChecks className="size-4" />} />
          <Stat label="运行中" value={activeCount} icon={<Play className="size-4" />} />
          <Stat
            label="暂停"
            value={tasks.length - activeCount}
            icon={<Pause className="size-4" />}
          />
        </section>

        <section
          className="overflow-hidden rounded-lg border border-border bg-card"
          aria-label="自动任务列表"
        >
          <div className="flex items-center justify-between border-border border-b px-5 py-4">
            <div>
              <h2 className="font-medium text-sm">当前自动任务</h2>
              <p className="mt-1 text-muted-foreground text-xs">共 {tasks.length} 个任务</p>
            </div>
            <Clock3 className="size-4 text-muted-foreground" />
          </div>
          {tasksQuery.isPending ? (
            <div className="space-y-3 p-5" aria-busy="true" role="status">
              <div className="h-16 animate-pulse rounded-md bg-accent" />
              <div className="h-16 animate-pulse rounded-md bg-accent" />
            </div>
          ) : tasksQuery.isError ? (
            <div className="px-5 py-14 text-center text-muted-foreground text-sm">
              读取自动任务失败，请稍后重试。
            </div>
          ) : tasks.length === 0 ? (
            <div className="px-5 py-16 text-center">
              <Clock3 className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-medium text-sm">还没有自动任务</p>
              <p className="mt-1 text-muted-foreground text-xs">
                创建第一个任务，让系统按间隔记录当前时间。
              </p>
              <Button className="mt-5" onClick={openCreate} type="button" variant="outline">
                <Plus className="size-4" /> 创建任务
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  onDelete={() => void deleteTask(task)}
                  onEdit={() => openEdit(task)}
                  onToggle={() => void toggleTask(task)}
                  task={task}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      <Dialog onOpenChange={(open) => !open && closeEditor()} open={isEditorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingTask ? "编辑自动任务" : "新增自动任务"}</DialogTitle>
            <DialogDescription>设置任务类型和执行间隔，保存后立即生效。</DialogDescription>
          </DialogHeader>
          <form className="space-y-5" onSubmit={(event) => void submitTask(event)}>
            <div className="space-y-2">
              <Label htmlFor="automation-name">任务名称</Label>
              <Input
                id="automation-name"
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                placeholder="例如：工作时间记录"
                value={draft.name}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-type">任务类型</Label>
              <Select
                onValueChange={(value) => setDraft({ ...draft, type: value as AutomationTaskType })}
                value={draft.type}
              >
                <SelectTrigger id="automation-type" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="log-current-time">
                    {automationTaskTypeLabels["log-current-time"]}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-interval">间隔时间（分钟）</Label>
              <Input
                id="automation-interval"
                min="1"
                onChange={(event) => setDraft({ ...draft, intervalMinutes: event.target.value })}
                type="number"
                value={draft.intervalMinutes}
              />
              <p className="text-muted-foreground text-xs">最短 1 分钟，任务运行期间可随时编辑。</p>
            </div>
            <label className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-3">
              <span>
                <span className="block font-medium text-sm">创建后启用</span>
                <span className="mt-1 block text-muted-foreground text-xs">
                  关闭后任务不会自动执行
                </span>
              </span>
              <input
                aria-label="创建后启用"
                checked={draft.enabled}
                className="size-4 accent-foreground"
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                type="checkbox"
              />
            </label>
            <DialogFooter>
              <Button onClick={closeEditor} type="button" variant="outline">
                取消
              </Button>
              <Button disabled={saveMutation.isPending || !draft.name.trim()} type="submit">
                {editingTask ? "保存更改" : "创建任务"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </main>
  );
}

function Stat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3">
      <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {icon}
      </span>
      <span>
        <span className="block font-mono text-lg leading-tight">{value}</span>
        <span className="text-muted-foreground text-xs">{label}</span>
      </span>
    </div>
  );
}

function TaskRow({
  onDelete,
  onEdit,
  onToggle,
  task,
}: {
  onDelete: () => void;
  onEdit: () => void;
  onToggle: () => void;
  task: AutomationTask;
}) {
  return (
    <article className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-accent/25 sm:flex-nowrap">
      <span
        className={`size-2 shrink-0 rounded-full ${task.enabled ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate font-medium text-sm">{task.name}</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
            {task.enabled ? "运行中" : "已暂停"}
          </span>
        </div>
        <p className="mt-1 text-muted-foreground text-xs">
          {automationTaskTypeLabels[task.type]} · 每 {task.intervalMinutes} 分钟执行
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          aria-label={task.enabled ? `暂停${task.name}` : `启用${task.name}`}
          onClick={onToggle}
          size="icon"
          type="button"
          variant="ghost"
        >
          {task.enabled ? <Pause className="size-4" /> : <Play className="size-4" />}
        </Button>
        <Button
          aria-label={`编辑${task.name}`}
          onClick={onEdit}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Edit3 className="size-4" />
        </Button>
        <Button
          aria-label={`删除${task.name}`}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={onDelete}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Trash2 className="size-4" />
        </Button>
        <Button
          aria-label="更多操作"
          className="hidden sm:inline-flex"
          size="icon"
          type="button"
          variant="ghost"
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </div>
    </article>
  );
}

export { AutomationsPage };
