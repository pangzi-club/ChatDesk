import {
  loadServerWorkspaceGit,
  loadServerWorkspaces,
  registerServerWorkspace,
  removeServerWorkspace,
} from "@/lib/chat-server";
import { pickDirectory } from "@/lib/platform";
import { normalizeWorkspacePath } from "./workspace-path";

export const WORKSPACE_PROJECTS_STORE_KEY = "workspace-projects";

export type WorkspaceProject = {
  id: string;
  path: string;
  name?: string;
  createdAt: string;
  updatedAt?: string;
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
  const seenPaths = new Set<string>();
  return (await loadServerWorkspaces()).filter((value) => {
    if (!isWorkspaceProject(value)) return false;
    const normalizedPath = normalizeWorkspacePath(value.path);
    if (seenPaths.has(normalizedPath)) return false;
    seenPaths.add(normalizedPath);
    return true;
  }) as WorkspaceProject[];
}

export async function saveWorkspaceProjects(projects: WorkspaceProject[]) {
  for (const project of projects) await registerServerWorkspace(project);
}

export async function addWorkspaceProject(path: string) {
  const normalizedPath = path.trim();
  if (!normalizedPath) throw new Error("项目路径不能为空");
  return registerServerWorkspace({ path: normalizedPath });
}

export async function removeWorkspaceProject(id: string) {
  await removeServerWorkspace(id);
}

export async function selectWorkspaceDirectory() {
  return pickDirectory();
}

export async function loadWorkspaceGitInfo(id: string) {
  return (await loadServerWorkspaceGit(id)) as WorkspaceGitInfo;
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
