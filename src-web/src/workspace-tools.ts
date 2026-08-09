import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { existsSync, realpathSync } from "node:fs";
import path from "node:path";
import { tool, type ToolSet } from "ai";
import { z } from "zod";
import type { SandboxMode } from "./protocol.ts";
import { resolveCommandCwd, runSandboxedShell } from "./sandbox-exec.ts";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SEARCH_RESULTS = 500;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "target", "dist"]);
function rootPath(cwd: string) {
  const value = cwd.trim();
  if (!value) throw new Error("请选择 workspace 后再使用文件工具");
  try {
    return realpathSync(value);
  } catch {
    throw new Error(`workspace 不存在：${value}`);
  }
}

function canonicalizeTarget(target: string) {
  const missingParts: string[] = [];
  let existing = target;
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missingParts.unshift(path.basename(existing));
    existing = parent;
  }
  try {
    return path.resolve(realpathSync(existing), ...missingParts);
  } catch {
    throw new Error("无法解析目标路径");
  }
}

function withinRoot(root: string, candidate: string) {
  const resolved = canonicalizeTarget(path.resolve(root, candidate || "."));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("路径必须位于当前 workspace 内");
  }
  return resolved;
}

function resolveTarget(root: string, candidate: string, mode: SandboxMode, allowOutside = false) {
  const trimmed = candidate.trim();
  if (mode === "full" || allowOutside) {
    return canonicalizeTarget(path.resolve(root, trimmed));
  }
  return withinRoot(root, trimmed);
}

async function listDirectory(
  cwd: string,
  relativePath: string | undefined,
  mode: SandboxMode,
  allowOutside = false,
) {
  const root = rootPath(cwd);
  const target = resolveTarget(root, relativePath || ".", mode, allowOutside);
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

async function readTextFile(
  cwd: string,
  relativePath: string,
  mode: SandboxMode,
  allowOutside = false,
) {
  const root = rootPath(cwd);
  const target = resolveTarget(root, relativePath, mode, allowOutside);
  const metadata = await stat(target);
  if (!metadata.isFile()) throw new Error("路径不是文件");
  if (metadata.size > MAX_FILE_BYTES) throw new Error("文件超过 512 KB，未读取");
  return { path: path.relative(root, target), content: await readFile(target, "utf8") };
}

async function searchFiles(
  cwd: string,
  options: { path?: string; pattern?: string; query?: string; maxResults?: number },
  mode: SandboxMode,
  allowOutside = false,
) {
  const root = rootPath(cwd);
  const start = resolveTarget(root, options.path || ".", mode, allowOutside);
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

export function createWorkspaceTools(
  cwd: string,
  mode: SandboxMode = "ask",
  approvedToolCallIds = new Set<string>(),
): ToolSet {
  const pathScope =
    mode === "full"
      ? "完全访问模式下也可使用外部绝对路径。"
      : "受限模式下路径必须位于当前 workspace 内。";
  const tools: ToolSet = {
    list_dir: tool({
      description: `列出文件与子目录。${pathScope}`,
      inputSchema: z.object({ path: z.string().optional() }),
      execute: ({ path: relativePath }, { toolCallId }) =>
        listDirectory(cwd, relativePath, mode, approvedToolCallIds.has(toolCallId)),
    }),
    read_file: tool({
      description: `读取文本文件。${pathScope}`,
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: ({ path: relativePath }, { toolCallId }) =>
        readTextFile(cwd, relativePath, mode, approvedToolCallIds.has(toolCallId)),
    }),
    search_files: tool({
      description: `按文件名模式或文本内容搜索文件。${pathScope}`,
      inputSchema: z.object({
        path: z.string().optional(),
        pattern: z.string().optional(),
        query: z.string().optional(),
        maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
      }),
      execute: (options, { toolCallId }) =>
        searchFiles(cwd, options, mode, approvedToolCallIds.has(toolCallId)),
    }),
    write_file: tool({
      description: `创建或覆盖文本文件。${pathScope}`,
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
      execute: async ({ path: relativePath, content }, { toolCallId }) => {
        const root = rootPath(cwd);
        const target = resolveTarget(root, relativePath, mode, approvedToolCallIds.has(toolCallId));
        await writeFile(target, content, "utf8");
        return { path: path.relative(root, target), bytes: Buffer.byteLength(content) };
      },
    }),
    edit_file: tool({
      description: `将文件中唯一匹配的文本替换为新内容。${pathScope}`,
      inputSchema: z.object({ path: z.string().min(1), oldText: z.string().min(1), newText: z.string() }),
      execute: async ({ path: relativePath, oldText, newText }, { toolCallId }) => {
        const root = rootPath(cwd);
        const target = resolveTarget(root, relativePath, mode, approvedToolCallIds.has(toolCallId));
        const content = await readFile(target, "utf8");
        const count = content.split(oldText).length - 1;
        if (count !== 1) throw new Error(count === 0 ? "未找到要替换的文本" : "oldText 必须只匹配一次");
        await writeFile(target, content.replace(oldText, newText), "utf8");
        return { path: path.relative(root, target), changed: true };
      },
    }),
    bash: tool({
      description: `执行 Bash 命令。${pathScope}完全访问模式支持外部 Bash cwd。`,
      inputSchema: z.object({
        command: z.string().min(1),
        cwd: z.string().optional().describe("可选的 Bash 工作目录；完全访问模式支持外部绝对路径"),
      }),
      execute: async ({ command, cwd: requestedCwd }, { toolCallId }) => {
        const allowOutside = approvedToolCallIds.has(toolCallId);
        const commandCwd = resolveCommandCwd(cwd, requestedCwd, mode, allowOutside);
        return runSandboxedShell(command, { cwd: commandCwd, mode, allowOutside });
      },
    }),
  };
  return tools;
}
