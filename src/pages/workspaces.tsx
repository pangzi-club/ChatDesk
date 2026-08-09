import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  FileCode2,
  FolderGit2,
  GitBranch,
  Plus,
  RefreshCw,
  Trash2,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

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
import { Button } from "@/components/ui/button";
import {
  addWorkspaceProject,
  loadWorkspaceGitInfo,
  loadWorkspaceProjects,
  removeWorkspaceProject,
  selectWorkspaceDirectory,
  type WorkspaceCommit,
  type WorkspaceGitInfo,
  type WorkspaceProject,
} from "@/lib/workspaces";

function WorkspacesPage() {
  const queryClient = useQueryClient();
  const [projectToRemove, setProjectToRemove] = useState<WorkspaceProject | null>(null);
  const projectsQuery = useQuery({
    queryKey: ["workspace-projects"],
    queryFn: loadWorkspaceProjects,
  });
  const addMutation = useMutation({
    mutationFn: async () => {
      const path = await selectWorkspaceDirectory();
      return path ? addWorkspaceProject(path) : null;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["workspace-projects"] }),
  });
  const removeMutation = useMutation({
    mutationFn: removeWorkspaceProject,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["workspace-projects"] });
      setProjectToRemove(null);
    },
  });
  const projects = projectsQuery.data ?? [];
  const error = addMutation.error ?? removeMutation.error ?? projectsQuery.error;

  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-4 pt-12 pb-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-medium text-muted-foreground text-xs uppercase tracking-[0.16em]">
            Development
          </p>
          <h1 className="mt-2 font-semibold text-3xl tracking-tight">Workspaces</h1>
          <p className="mt-2 text-muted-foreground text-sm">
            管理本地项目目录，快速查看 Git 状态和最近提交。
          </p>
        </div>
        <Button
          disabled={addMutation.isPending}
          onClick={() => void addMutation.mutateAsync()}
          type="button"
        >
          <Plus className="size-4" /> 添加项目
        </Button>
      </header>
      {error ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {describeError(error)}
        </p>
      ) : null}
      {projectsQuery.isPending ? (
        <ProjectSkeleton />
      ) : projects.length === 0 ? (
        <EmptyProjects />
      ) : (
        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-border border-b px-5 py-4">
            <h2 className="font-medium text-sm">
              已保存项目 <span className="ml-1 text-muted-foreground">{projects.length}</span>
            </h2>
          </div>
          <div className="divide-y divide-border">
            {projects.map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                onRemove={() => setProjectToRemove(project)}
                removing={removeMutation.isPending}
              />
            ))}
          </div>
        </section>
      )}
      <AlertDialog
        open={projectToRemove !== null}
        onOpenChange={(open) => {
          if (!open && !removeMutation.isPending) setProjectToRemove(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>移除 Workspace？</AlertDialogTitle>
            <AlertDialogDescription>
              确定要移除“{projectToRemove ? projectName(projectToRemove) : "这个项目"}”吗？
              这只会移除保存的项目目录，不会删除历史聊天记录。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>取消</AlertDialogCancel>
            <AlertDialogAction
              disabled={removeMutation.isPending}
              onClick={() => {
                if (projectToRemove) removeMutation.mutate(projectToRemove.id);
              }}
              variant="destructive"
            >
              {removeMutation.isPending ? "移除中..." : "移除"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ProjectRow({
  project,
  onRemove,
  removing,
}: {
  project: WorkspaceProject;
  onRemove: () => void;
  removing: boolean;
}) {
  const name = projectName(project);
  return (
    <article className="flex flex-wrap items-center gap-3 px-5 py-4 transition-colors hover:bg-accent/30">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md bg-accent text-muted-foreground">
        <FolderGit2 className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-medium text-sm">{name}</h3>
        <p className="mt-1 break-all font-mono text-muted-foreground text-xs">{project.path}</p>
      </div>
      <Button asChild size="sm" variant="outline">
        <Link to={`/workspaces/${project.id}`}>查看详情</Link>
      </Button>
      <Button
        aria-label={`移除 ${name}`}
        className="text-destructive hover:text-destructive"
        disabled={removing}
        onClick={onRemove}
        size="icon"
        type="button"
        variant="ghost"
      >
        <Trash2 className="size-4" />
      </Button>
    </article>
  );
}

function projectName(project: WorkspaceProject) {
  return project.path.split(/[\\/]/).filter(Boolean).pop() ?? project.path;
}

function EmptyProjects() {
  return (
    <section className="rounded-lg border border-dashed border-border bg-card px-5 py-16 text-center">
      <FolderGit2 className="mx-auto size-9 text-muted-foreground" />
      <h2 className="mt-3 font-medium text-sm">还没有保存项目</h2>
      <p className="mt-1 text-muted-foreground text-xs">
        添加一个本地文件夹后，就可以在这里查看 Git 信息。
      </p>
    </section>
  );
}
function ProjectSkeleton() {
  return (
    <section
      className="overflow-hidden rounded-lg border border-border bg-card p-5"
      aria-busy="true"
    >
      <div className="animate-pulse space-y-3">
        <div className="h-16 rounded-md bg-accent" />
        <div className="h-16 rounded-md bg-accent" />
        <div className="h-16 rounded-md bg-accent" />
      </div>
    </section>
  );
}

function WorkspaceDetailPage() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const projectsQuery = useQuery({
    queryKey: ["workspace-projects"],
    queryFn: loadWorkspaceProjects,
  });
  const project = projectsQuery.data?.find((item) => item.id === projectId);
  const gitQuery = useQuery({
    queryKey: ["workspace-git", project?.path],
    queryFn: () => loadWorkspaceGitInfo(project?.path ?? ""),
    enabled: Boolean(project),
  });
  if (projectsQuery.isPending)
    return (
      <div className="p-8 pt-16">
        <ProjectSkeleton />
      </div>
    );
  if (!project)
    return (
      <div className="flex flex-col gap-4 px-4 pt-16 sm:px-8">
        <p className="text-muted-foreground text-sm">找不到这个项目。</p>
        <Button onClick={() => navigate("/workspaces")} type="button" variant="outline">
          <ArrowLeft className="size-4" /> 返回项目列表
        </Button>
      </div>
    );
  return (
    <div className="flex w-full flex-1 flex-col gap-6 px-4 pt-12 pb-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Button asChild className="mb-4 -ml-2" size="sm" variant="ghost">
            <Link to="/workspaces">
              <ArrowLeft className="size-4" /> 返回列表
            </Link>
          </Button>
          <h1 className="font-semibold text-3xl tracking-tight">
            {project.path.split(/[\\/]/).filter(Boolean).pop() ?? project.path}
          </h1>
          <p className="mt-2 break-all font-mono text-muted-foreground text-sm">{project.path}</p>
        </div>
        <Button
          aria-label="刷新 Git 信息"
          disabled={gitQuery.isFetching}
          onClick={() => void gitQuery.refetch()}
          size="icon"
          type="button"
          variant="outline"
        >
          <RefreshCw className={gitQuery.isFetching ? "size-4 animate-spin" : "size-4"} />
        </Button>
      </header>
      {gitQuery.isPending ? (
        <GitSkeleton />
      ) : gitQuery.isError ? (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive text-sm">
          {describeError(gitQuery.error)}
        </p>
      ) : gitQuery.data ? (
        <GitContent info={gitQuery.data} />
      ) : null}
    </div>
  );
}

function GitContent({ info }: { info: WorkspaceGitInfo }) {
  if (info.error)
    return (
      <section className="rounded-lg border border-destructive/40 bg-destructive/10 p-5">
        <h2 className="font-medium text-sm">无法读取 Git 信息</h2>
        <p className="mt-2 text-destructive text-sm">{info.error}</p>
      </section>
    );
  if (!info.isRepository)
    return (
      <section className="rounded-lg border border-dashed border-border bg-card px-5 py-14 text-center">
        <FileCode2 className="mx-auto size-8 text-muted-foreground" />
        <h2 className="mt-3 font-medium text-sm">不是 Git 仓库</h2>
        <p className="mt-1 text-muted-foreground text-xs">该目录可以继续保存在项目列表中。</p>
      </section>
    );
  const status = info.status;
  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-3">
          <GitBranch className="size-4 text-muted-foreground" />
          <span className="font-medium text-sm">{status?.branch ?? "未知分支"}</span>
          {status?.clean ? (
            <span className="inline-flex items-center gap-1 text-emerald-600 text-xs">
              <CheckCircle2 className="size-3.5" /> 工作区干净
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-amber-600 text-xs">
              <XCircle className="size-3.5" /> 有未提交变更
            </span>
          )}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ["暂存", status?.staged ?? 0],
            ["已修改", status?.modified ?? 0],
            ["未跟踪", status?.untracked ?? 0],
            ["冲突", status?.conflicted ?? 0],
          ].map(([label, value]) => (
            <div className="rounded-md bg-accent/60 px-3 py-2" key={label as string}>
              <p className="text-muted-foreground text-xs">{label}</p>
              <p className="mt-1 font-semibold text-lg">{value}</p>
            </div>
          ))}
        </div>
        {status && (status.ahead > 0 || status.behind > 0) ? (
          <p className="mt-3 text-muted-foreground text-xs">
            {status.ahead ? `领先远程 ${status.ahead} 个提交` : ""}
            {status.ahead && status.behind ? "，" : ""}
            {status.behind ? `落后远程 ${status.behind} 个提交` : ""}
          </p>
        ) : null}
      </section>
      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-border border-b px-5 py-4">
          <Clock3 className="size-4 text-muted-foreground" />
          <h2 className="font-medium text-sm">最近 10 个 commit</h2>
        </div>
        {info.commits.length ? (
          <div className="divide-y divide-border">
            {info.commits.map((commit) => (
              <CommitRow commit={commit} key={commit.hash} />
            ))}
          </div>
        ) : (
          <p className="px-5 py-12 text-center text-muted-foreground text-sm">暂无提交记录</p>
        )}
      </section>
    </div>
  );
}
function CommitRow({ commit }: { commit: WorkspaceCommit }) {
  return (
    <article className="flex gap-3 px-5 py-4">
      <span className="mt-0.5 rounded bg-accent px-2 py-1 font-mono text-muted-foreground text-xs">
        {commit.shortHash}
      </span>
      <div className="min-w-0 flex-1">
        <p className="break-words font-medium text-sm">{commit.subject}</p>
        <p className="mt-1 text-muted-foreground text-xs">
          {commit.author} · {formatDate(commit.date)}
        </p>
      </div>
    </article>
  );
}
function GitSkeleton() {
  return (
    <div className="animate-pulse space-y-5">
      <div className="h-40 rounded-lg bg-accent" />
      <div className="h-64 rounded-lg bg-accent" />
    </div>
  );
}
function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}
function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export { WorkspaceDetailPage, WorkspacesPage };
