import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SEARCH_RESULTS = 500;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "target", "dist"]);

function rootPath(cwd: string) {
  const value = cwd.trim();
  if (!value) throw new Error("请选择 workspace 后再使用文件工具");
  return path.resolve(value);
}

function withinRoot(root: string, candidate: string) {
  const resolved = path.resolve(root, candidate || ".");
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("路径必须位于当前 workspace 内");
  }
  return resolved;
}

async function listDirectory(cwd: string, relativePath?: string) {
  const root = rootPath(cwd);
  const target = withinRoot(root, relativePath || ".");
  const entries = await readdir(target, { withFileTypes: true });
  return {
    path: path.relative(root, target) || ".",
    entries: entries
      .filter((entry) => !SKIPPED_DIRECTORIES.has(entry.name))
      .map((entry) => ({
        name: entry.name,
        path: path.relative(root, path.join(target, entry.name)),
        kind: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
      }))
      .sort((a, b) => a.path.localeCompare(b.path)),
  };
}

async function readTextFile(cwd: string, relativePath: string) {
  const root = rootPath(cwd);
  const target = withinRoot(root, relativePath);
  const metadata = await stat(target);
  if (!metadata.isFile()) throw new Error("路径不是文件");
  if (metadata.size > MAX_FILE_BYTES) throw new Error("文件超过 512 KB，未读取");
  return { path: path.relative(root, target), content: await readFile(target, "utf8") };
}

async function searchFiles(
  cwd: string,
  options: { path?: string; pattern?: string; query?: string; maxResults?: number },
) {
  const root = rootPath(cwd);
  const start = withinRoot(root, options.path || ".");
  const limit = Math.min(Math.max(options.maxResults ?? 100, 1), MAX_SEARCH_RESULTS);
  const matches: string[] = [];
  const needle = options.query?.trim().toLowerCase();
  const pattern = options.pattern?.trim();

  async function visit(directory: string): Promise<void> {
    if (matches.length >= limit) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (matches.length >= limit) return;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      if (pattern && !new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")}$$`, "i").test(entry.name)) continue;
      const target = path.join(directory, entry.name);
      if (needle) {
        const metadata = await stat(target);
        if (metadata.size > MAX_FILE_BYTES) continue;
        let content = "";
        try {
          content = await readFile(target, "utf8");
        } catch {
          continue;
        }
        if (!content.toLowerCase().includes(needle)) continue;
      }
      matches.push(path.relative(root, target));
    }
  }

  await visit(start);
  return { query: options.query?.trim() || undefined, pattern, matches, truncated: matches.length >= limit };
}

export function createWorkspaceTools(cwd: string): ToolSet {
  return {
    list_dir: tool({
      description: "列出当前 workspace 内的文件与子目录。",
      inputSchema: z.object({ path: z.string().optional() }),
      execute: ({ path: relativePath }) => listDirectory(cwd, relativePath),
    }),
    read_file: tool({
      description: "读取当前 workspace 内的文本文件。",
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: ({ path: relativePath }) => readTextFile(cwd, relativePath),
    }),
    search_files: tool({
      description: "按文件名模式或文本内容搜索当前 workspace。",
      inputSchema: z.object({
        path: z.string().optional(),
        pattern: z.string().optional(),
        query: z.string().optional(),
        maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
      }),
      execute: (options) => searchFiles(cwd, options),
    }),
  };
}
