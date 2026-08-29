import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock3,
  Edit3,
  Eye,
  ListChecks,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  Trash2,
} from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { loadAgents } from "@/lib/agents";
import {
  type AutomationTask,
  loadAutomationRuns,
  loadAutomationTasks,
  saveAutomationTasks,
} from "@/lib/automation";
import {
  type ChannelContact,
  type FeishuChannelStatus,
  loadFeishuChannelStatuses,
  loadFeishuContacts,
} from "@/lib/chat-server";

const AUTOMATION_QUERY_KEY = ["automation-tasks"];

function toLocalDateTimeInput(value: Date | string) {
  const date = typeof value === "string" ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function runStatusLabel(status: string) {
  return (
    (
      {
        queued: "排队中",
        running: "执行中",
        success: "成功",
        failed: "失败",
        skipped: "已跳过",
      } as Record<string, string>
    )[status] ?? status
  );
}

type TaskDraft = {
  name: string;
  description: string;
  scheduleMode: "once" | "interval";
  intervalMinutes: string;
  startAt: string;
  agentId: string;
  notificationChannelId: string;
  notificationContactId: string;
  enabled: boolean;
};

const emptyDraft: TaskDraft = {
  name: "",
  description: "",
  scheduleMode: "interval",
  intervalMinutes: "60",
  startAt: toLocalDateTimeInput(new Date(Date.now() + 60_000)),
  agentId: "",
  notificationChannelId: "",
  notificationContactId: "",
  enabled: true,
};

function AutomationsPage() {
  const queryClient = useQueryClient();
  const tasksQuery = useQuery({
    queryKey: AUTOMATION_QUERY_KEY,
    queryFn: loadAutomationTasks,
    refetchInterval: 3000,
  });
  const agentsQuery = useQuery({ queryKey: ["agents"], queryFn: loadAgents });
  const channelsQuery = useQuery<FeishuChannelStatus[]>({
    queryKey: ["feishu-status", "all"],
    queryFn: () => loadFeishuChannelStatuses(),
  });
  const contactsQuery = useQuery<ChannelContact[]>({
    queryKey: ["feishu-contacts"],
    queryFn: () => loadFeishuContacts(),
  });
  const saveMutation = useMutation({
    mutationFn: saveAutomationTasks,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: AUTOMATION_QUERY_KEY }),
  });
  const tasks = tasksQuery.data ?? [];
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<AutomationTask | null>(null);
  const [pendingDeleteTask, setPendingDeleteTask] = useState<AutomationTask | null>(null);
  const [viewingTask, setViewingTask] = useState<AutomationTask | null>(null);
  const [draft, setDraft] = useState<TaskDraft>(emptyDraft);
  const runsQuery = useQuery({
    queryKey: ["automation-runs", viewingTask?.id],
    queryFn: () => loadAutomationRuns(viewingTask?.id ?? ""),
    enabled: Boolean(viewingTask),
    refetchInterval: (query) =>
      query.state.data?.some((run) => run.status === "running" || run.status === "queued")
        ? 3000
        : false,
  });

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
      description: task.description,
      scheduleMode: task.scheduleMode,
      intervalMinutes: String(task.intervalMinutes),
      startAt: toLocalDateTimeInput(task.startAt),
      agentId: task.agentId,
      notificationChannelId: task.notificationChannelId ?? "",
      notificationContactId: task.notificationContactId ?? "",
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
    const description = draft.description.trim();
    if (
      !name ||
      !description ||
      !draft.agentId ||
      !Number.isFinite(intervalMinutes) ||
      intervalMinutes < 1
    )
      return;

    const now = new Date().toISOString();
    const nextTask: AutomationTask = editingTask
      ? {
          ...editingTask,
          name,
          description,
          scheduleMode: draft.scheduleMode,
          intervalMinutes,
          startAt: new Date(draft.startAt).toISOString(),
          agentId: draft.agentId,
          notificationChannelId: draft.notificationChannelId || undefined,
          notificationContactId: draft.notificationContactId || undefined,
          enabled: draft.enabled,
          updatedAt: now,
        }
      : {
          id: crypto.randomUUID(),
          name,
          description,
          scheduleMode: draft.scheduleMode,
          intervalMinutes,
          startAt: new Date(draft.startAt).toISOString(),
          agentId: draft.agentId,
          notificationChannelId: draft.notificationChannelId || undefined,
          notificationContactId: draft.notificationContactId || undefined,
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

  async function confirmDeleteTask() {
    if (!pendingDeleteTask) return;
    const task = pendingDeleteTask;
    setPendingDeleteTask(null);
    const nextTasks = tasks.filter((item) => item.id !== task.id);
    queryClient.setQueryData<AutomationTask[]>(AUTOMATION_QUERY_KEY, nextTasks);
    try {
      await saveMutation.mutateAsync(nextTasks);
    } catch {
      queryClient.invalidateQueries({ queryKey: AUTOMATION_QUERY_KEY });
    }
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
    <main className="app-page-root min-h-full px-5 pt-14 pb-10 text-foreground sm:px-8 lg:px-12">
      <div className="app-page-container mx-auto max-w-5xl">
        <header className="flex flex-wrap items-end justify-between gap-5 border-border border-b pb-6">
          <div>
            <p className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.18em]">
              Workspace / Automation
            </p>
            <h1 className="mt-2 font-semibold text-3xl tracking-tight">自动化</h1>
            <p className="mt-2 max-w-xl text-muted-foreground text-sm">
              让重复的小事按固定节奏运行，执行结果会写入活动记录。
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
                  onDelete={() => setPendingDeleteTask(task)}
                  onDetails={() => setViewingTask(task)}
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
        <DialogContent className="max-h-[calc(100vh-2rem)] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingTask ? "编辑自动任务" : "新增自动任务"}</DialogTitle>
            <DialogDescription>
              描述任务目标，选择 Agent 和执行间隔，保存后立即生效。
            </DialogDescription>
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
              <Label htmlFor="automation-description">任务描述</Label>
              <Textarea
                id="automation-description"
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                placeholder="例如：整理今天的项目进展并给出明天的计划"
                value={draft.description}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-agent">执行 Agent</Label>
              <Select
                onValueChange={(value) => setDraft({ ...draft, agentId: value })}
                value={draft.agentId}
              >
                <SelectTrigger id="automation-agent" className="w-full">
                  <SelectValue placeholder="选择 Agent" />
                </SelectTrigger>
                <SelectContent>
                  {(agentsQuery.data ?? []).map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      {agent.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-schedule-mode">执行方式</Label>
              <Select
                onValueChange={(value) =>
                  setDraft({ ...draft, scheduleMode: value as TaskDraft["scheduleMode"] })
                }
                value={draft.scheduleMode}
              >
                <SelectTrigger id="automation-schedule-mode" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="interval">重复执行</SelectItem>
                  <SelectItem value="once">单次执行</SelectItem>
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
                disabled={draft.scheduleMode === "once"}
              />
              <div
                className={`flex flex-wrap gap-2 ${draft.scheduleMode === "once" ? "pointer-events-none opacity-50" : ""}`}
              >
                {[60, 1440, 10080].map((minutes) => (
                  <Button
                    key={minutes}
                    onClick={() => setDraft({ ...draft, intervalMinutes: String(minutes) })}
                    type="button"
                    variant="outline"
                  >
                    {minutes === 60 ? "60 分钟" : minutes === 1440 ? "1 天" : "7 天"}
                  </Button>
                ))}
              </div>
              <p className="text-muted-foreground text-xs">最短 1 分钟，任务运行期间可随时编辑。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-start">开始时间</Label>
              <Input
                id="automation-start"
                onChange={(event) => setDraft({ ...draft, startAt: event.target.value })}
                type="datetime-local"
                value={draft.startAt}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="automation-channel">通知 Channel（可选）</Label>
              <Select
                onValueChange={(value) => {
                  const channel = (channelsQuery.data ?? []).find(
                    (item) => item.channelId === value,
                  );
                  setDraft({
                    ...draft,
                    notificationChannelId: value,
                    notificationContactId: "",
                    agentId: channel?.agentId ?? draft.agentId,
                  });
                }}
                value={draft.notificationChannelId}
              >
                <SelectTrigger id="automation-channel" className="w-full">
                  <SelectValue placeholder="不发送通知" />
                </SelectTrigger>
                <SelectContent>
                  {(channelsQuery.data ?? [])
                    .filter((item) => item.channelId)
                    .map((channel) => (
                      <SelectItem key={channel.channelId} value={channel.channelId ?? ""}>
                        {channel.name ?? channel.channelId}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
            </div>
            {draft.notificationChannelId ? (
              <div className="space-y-2">
                <Label htmlFor="automation-contact">通知联系人</Label>
                <Select
                  onValueChange={(value) => setDraft({ ...draft, notificationContactId: value })}
                  value={draft.notificationContactId}
                >
                  <SelectTrigger id="automation-contact" className="w-full">
                    <SelectValue placeholder="选择联系人" />
                  </SelectTrigger>
                  <SelectContent>
                    {(contactsQuery.data ?? [])
                      .filter((contact) => contact.channelId === draft.notificationChannelId)
                      .map((contact) => (
                        <SelectItem key={contact.id} value={contact.id}>
                          {contact.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <label className="flex cursor-pointer items-center justify-between rounded-md border border-border bg-muted/30 px-3 py-3">
              <span>
                <span className="block font-medium text-sm">启用任务</span>
                <span className="mt-1 block text-muted-foreground text-xs">
                  关闭后任务不会自动执行
                </span>
              </span>
              <input
                aria-label="启用任务"
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
              <Button
                disabled={
                  saveMutation.isPending ||
                  !draft.name.trim() ||
                  !draft.description.trim() ||
                  !draft.agentId
                }
                type="submit"
              >
                {editingTask ? "保存更改" : "创建任务"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        onOpenChange={(open) => !open && setPendingDeleteTask(null)}
        open={pendingDeleteTask !== null}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除自动任务？</DialogTitle>
            <DialogDescription>
              确定删除“{pendingDeleteTask?.name}”吗？删除后将停止执行且无法恢复。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPendingDeleteTask(null)} type="button" variant="outline">
              取消
            </Button>
            <Button
              disabled={saveMutation.isPending}
              onClick={() => void confirmDeleteTask()}
              type="button"
              variant="destructive"
            >
              删除任务
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog onOpenChange={(open) => !open && setViewingTask(null)} open={viewingTask !== null}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>执行详情 · {viewingTask?.name}</DialogTitle>
            <DialogDescription>查看执行状态、输出和错误。</DialogDescription>
          </DialogHeader>
          {runsQuery.isPending ? (
            <div className="h-24 animate-pulse rounded-md bg-accent" />
          ) : runsQuery.data?.length ? (
            <div className="max-h-[min(60vh,520px)] space-y-3 overflow-y-auto">
              {runsQuery.data.map((run) => (
                <div className="rounded-md border border-border p-3" key={run.id}>
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      {run.source === "manual" ? "手动" : "定时"} · {runStatusLabel(run.status)}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>
                  </div>
                  {run.output ? (
                    <p className="mt-2 whitespace-pre-wrap text-sm">{run.output}</p>
                  ) : null}
                  {run.error ? <p className="mt-2 text-destructive text-sm">{run.error}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="py-8 text-center text-muted-foreground text-sm">暂无执行记录</p>
          )}
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
  onDetails,
  onEdit,
  onToggle,
  task,
}: {
  onDelete: () => void;
  onDetails: () => void;
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
          {task.description} ·{" "}
          {task.scheduleMode === "once" ? "单次执行" : `每 ${task.intervalMinutes} 分钟执行`} ·{" "}
          {new Date(task.startAt).toLocaleString()}
        </p>
      </div>
      <div className="flex items-center gap-1">
        <Button
          aria-label={`查看${task.name}执行详情`}
          onClick={onDetails}
          size="icon"
          type="button"
          variant="ghost"
        >
          <Eye className="size-4" />
        </Button>
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
