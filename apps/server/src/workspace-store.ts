import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export type WorkspaceProject = {
  id: string;
  path: string;
  name: string;
  createdAt: string;
  updatedAt: string;
};

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

export class WorkspaceStore {
  private readonly file: string;
  private value: WorkspaceProject[] = [];

  constructor(dataDir: string) {
    this.file = path.join(dataDir, "workspaces.json");
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
