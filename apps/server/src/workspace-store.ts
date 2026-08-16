import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME } from "@chatdesk/shared";

export type WorkspaceProject = {
  id: string;
  path: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

export { DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_NAME };

function isWorkspace(value: unknown): value is WorkspaceProject {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<WorkspaceProject>;
  return (
    typeof item.id === "string" &&
    typeof item.path === "string" &&
    typeof item.name === "string" &&
    typeof item.createdAt === "string" &&
    typeof item.updatedAt === "string"
  );
}

function normalizeWorkspacePath(value: string) {
  return path.normalize(value.trim());
}

export function defaultTasksRoot(dataDir: string) {
  const resolved = path.resolve(dataDir);
  return path.basename(resolved) === "chat-server"
    ? path.join(path.dirname(resolved), "tasks")
    : path.join(resolved, "tasks");
}

export function taskCwdFor(tasksRoot: string, sessionId: string) {
  return path.resolve(path.join(tasksRoot, sessionId));
}

export function isPathInside(value: string, root: string) {
  const resolved = path.resolve(value);
  const resolvedRoot = path.resolve(root);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`);
}

export function isDefaultWorkspaceId(value: string | null | undefined) {
  return !value?.trim() || value.trim() === DEFAULT_WORKSPACE_ID;
}

export class WorkspaceStore {
  private readonly dataDir: string;
  private readonly file: string;
  private value: WorkspaceProject[] = [];

  constructor(dataDir: string) {
    this.dataDir = dataDir;
    this.file = path.join(dataDir, "workspaces.json");
  }

  tasksRoot() {
    return defaultTasksRoot(this.dataDir);
  }

  taskCwdForSession(sessionId: string) {
    const root = this.get(DEFAULT_WORKSPACE_ID)?.path ?? this.tasksRoot();
    return taskCwdFor(root, sessionId);
  }

  async init() {
    await mkdir(path.dirname(this.file), { recursive: true });
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as unknown;
      const seenPaths = new Set<string>();
      this.value = Array.isArray(parsed)
        ? parsed.filter((item): item is WorkspaceProject => {
            if (!isWorkspace(item)) return false;
            const normalizedPath = normalizeWorkspacePath(item.path);
            if (seenPaths.has(normalizedPath)) return false;
            seenPaths.add(normalizedPath);
            item.path = normalizedPath;
            return true;
          })
        : [];
    } catch {
      this.value = [];
    }
  }

  async ensureDefault() {
    const tasksRoot = path.resolve(this.tasksRoot());
    await mkdir(tasksRoot, { recursive: true });
    const existing = this.get(DEFAULT_WORKSPACE_ID);
    if (existing) {
      await mkdir(existing.path, { recursive: true });
      return structuredClone(existing);
    }
    const now = new Date().toISOString();
    const project: WorkspaceProject = {
      id: DEFAULT_WORKSPACE_ID,
      path: tasksRoot,
      name: DEFAULT_WORKSPACE_NAME,
      createdAt: now,
      updatedAt: now,
    };
    this.value = [project, ...this.value];
    await this.save();
    return structuredClone(project);
  }

  async ensureTaskCwd(sessionId: string, cwd?: string) {
    await this.ensureDefault();
    const sessionRoot = this.taskCwdForSession(sessionId);
    const requested = cwd?.trim();
    const resolved =
      requested && isPathInside(requested, sessionRoot) ? path.resolve(requested) : sessionRoot;
    await mkdir(resolved, { recursive: true });
    return resolved;
  }

  async bindSession(sessionId: string, workspaceId?: string, cwd?: string) {
    const id = workspaceId?.trim() || DEFAULT_WORKSPACE_ID;
    const workspace = this.get(id);
    if (!workspace) throw new Error("workspace 不存在");
    if (id === DEFAULT_WORKSPACE_ID) {
      return {
        workspaceId: id,
        cwd: await this.ensureTaskCwd(sessionId, cwd),
      };
    }
    return { workspaceId: id, cwd: workspace.path };
  }

  list() {
    return structuredClone(this.value).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  get(id: string) {
    return this.value.find((item) => item.id === id);
  }

  async add(input: { path: string; name?: string }) {
    const normalizedPath = normalizeWorkspacePath(input.path);
    if (!normalizedPath) throw new Error("workspace 路径不能为空");
    const existing = this.value.find((item) => item.path === normalizedPath);
    if (existing) return structuredClone(existing);
    const now = new Date().toISOString();
    const project: WorkspaceProject = {
      id: randomUUID(),
      path: normalizedPath,
      name: input.name?.trim() || path.basename(normalizedPath) || normalizedPath,
      createdAt: now,
      updatedAt: now,
    };
    this.value = [project, ...this.value];
    await this.save();
    return structuredClone(project);
  }

  async remove(id: string) {
    if (id === DEFAULT_WORKSPACE_ID) throw new Error("不能删除 Default workspace");
    const before = this.value.length;
    this.value = this.value.filter((item) => item.id !== id);
    if (this.value.length !== before) await this.save();
    return before !== this.value.length;
  }

  private async save() {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await writeFile(temporary, JSON.stringify(this.value, null, 2), "utf8");
    await rename(temporary, this.file);
  }
}
