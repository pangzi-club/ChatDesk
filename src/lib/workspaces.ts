import { invoke } from "@tauri-apps/api/core";
import { settingsStore } from "@/lib/settings-store";

export const WORKSPACE_PROJECTS_STORE_KEY = "workspace-projects";

export type WorkspaceProject = {
  id: string;
  path: string;
  createdAt: string;
};

export type WorkspaceGitStatus = {
  isRepository: boolean;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
  clean: boolean;
};

export type WorkspaceCommit = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};

export type WorkspaceGitInfo = {
  pathExists: boolean;
  isRepository: boolean;
  status: WorkspaceGitStatus | null;
  commits: WorkspaceCommit[];
  error: string | null;
};

export async function loadWorkspaceProjects(): Promise<WorkspaceProject[]> {
  const stored = await settingsStore.get<unknown>(WORKSPACE_PROJECTS_STORE_KEY);
  if (!Array.isArray(stored)) return [];
  return stored.filter(isWorkspaceProject).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function saveWorkspaceProjects(projects: WorkspaceProject[]) {
  await settingsStore.set(WORKSPACE_PROJECTS_STORE_KEY, projects);
  await settingsStore.save();
}

export async function addWorkspaceProject(path: string) {
  const normalizedPath = path.trim();
  if (!normalizedPath) throw new Error("项目路径不能为空");
  const projects = await loadWorkspaceProjects();
  const existing = projects.find((project) => project.path === normalizedPath);
  if (existing) return existing;
  const project: WorkspaceProject = {
    id: crypto.randomUUID(),
    path: normalizedPath,
    createdAt: new Date().toISOString(),
  };
  await saveWorkspaceProjects([project, ...projects]);
  return project;
}

export async function removeWorkspaceProject(id: string) {
  const projects = await loadWorkspaceProjects();
  await saveWorkspaceProjects(projects.filter((project) => project.id !== id));
}

export async function selectWorkspaceDirectory() {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("文件夹选择仅支持桌面应用");
  }
  return invoke<string | null>("select_workspace_directory");
}

export async function loadWorkspaceGitInfo(path: string) {
  if (!("__TAURI_INTERNALS__" in window)) {
    throw new Error("Git 信息仅支持桌面应用");
  }
  return invoke<WorkspaceGitInfo>("inspect_workspace", { path });
}

function isWorkspaceProject(value: unknown): value is WorkspaceProject {
  if (!value || typeof value !== "object") return false;
  const project = value as Partial<WorkspaceProject>;
  return (
    typeof project.id === "string" &&
    typeof project.path === "string" &&
    typeof project.createdAt === "string"
  );
}
