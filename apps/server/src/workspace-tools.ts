import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import type { SandboxMode } from "./protocol.ts";
import { resolveCommandCwd, runSandboxedShell, SandboxBlockedError } from "./sandbox-exec.ts";

const MAX_FILE_BYTES = 512 * 1024;
const MAX_SEARCH_RESULTS = 500;
const MAX_GIT_FILE_LIST_BYTES = 32 * 1024 * 1024;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "target", "dist"]);
const execFileAsync = promisify(execFile);

type SandboxEscalationHandler = (toolCall: {
  toolName: string;
  toolCallId?: string;
  input: unknown;
}) => Promise<{ approved: boolean; reason?: string }>;
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
    throw new SandboxBlockedError("路径必须位于当前 workspace 内");
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

  const matchesFilePattern = (file: string) => {
    if (!pattern) return true;
    return new RegExp(
      `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$$`,
      "i",
    ).test(path.basename(file));
  };

  const matchesContent = async (target: string) => {
    if (!needle) return true;
    const metadata = await stat(target);
    if (!metadata.isFile() || metadata.size > MAX_FILE_BYTES) return false;
    try {
      return (await readFile(target, "utf8")).toLowerCase().includes(needle);
    } catch {
      return false;
    }
  };

  const addFile = async (target: string) => {
    if (matches.length >= limit || !matchesFilePattern(target)) return;
    try {
      const resolvedTarget = realpathSync(target);
      if (resolvedTarget !== root && !resolvedTarget.startsWith(`${root}${path.sep}`)) return;
      const metadata = await stat(resolvedTarget);
      if (!metadata.isFile() || !(await matchesContent(resolvedTarget))) return;
    } catch {
      return;
    }
    matches.push(path.relative(root, target));
  };

  const gitFiles = await listGitFiles(root, start);
  if (gitFiles) {
    for (const target of gitFiles) {
      await addFile(target);
      if (matches.length >= limit) break;
    }
    return {
      query: options.query?.trim() || undefined,
      pattern,
      matches,
      truncated: matches.length >= limit,
    };
  }

  async function visit(directory: string): Promise<void> {
    if (matches.length >= limit) return;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (matches.length >= limit) return;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const target = path.join(directory, entry.name);
      await addFile(target);
    }
  }

  await visit(start);
  return {
    query: options.query?.trim() || undefined,
    pattern,
    matches,
    truncated: matches.length >= limit,
  };
}

async function listGitFiles(root: string, start: string): Promise<string[] | null> {
  try {
    await execFileAsync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      timeout: 3_000,
      maxBuffer: 1_024 * 1024,
    });
    const relativeStart = path.relative(root, start) || ".";
    const result = await execFileAsync(
      "git",
      [
        "-C",
        root,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        relativeStart,
      ],
      { cwd: root, timeout: 10_000, maxBuffer: MAX_GIT_FILE_LIST_BYTES },
    );
    return result.stdout
      .split("\0")
      .filter(Boolean)
      .map((file) => path.resolve(root, file));
  } catch {
    return null;
  }
}

export function createWorkspaceTools(
  cwd: string,
  mode: SandboxMode = "ask",
  approvedToolCallIds = new Set<string>(),
  onSandboxBlocked?: SandboxEscalationHandler,
): ToolSet {
  const pathScope =
    mode === "full"
      ? "完全访问模式下也可使用外部绝对路径。"
      : "受限模式下路径必须位于当前 workspace 内。";
  const tools: ToolSet = {
    list_dir: tool({
      description: `列出文件与子目录。${pathScope}`,
      inputSchema: z.object({ path: z.string().optional() }),
      execute: async ({ path: relativePath }, { toolCallId }) => {
        const input = { path: relativePath };
        try {
          return await listDirectory(cwd, relativePath, mode, approvedToolCallIds.has(toolCallId));
        } catch (error) {
          return retryAfterSandboxReview(error, onSandboxBlocked, {
            toolName: "list_dir",
            toolCallId,
            input,
            retry: () => listDirectory(cwd, relativePath, mode, true),
          });
        }
      },
    }),
    read_file: tool({
      description: `读取文本文件。${pathScope}`,
      inputSchema: z.object({ path: z.string().min(1) }),
      execute: async ({ path: relativePath }, { toolCallId }) => {
        const input = { path: relativePath };
        try {
          return await readTextFile(cwd, relativePath, mode, approvedToolCallIds.has(toolCallId));
        } catch (error) {
          return retryAfterSandboxReview(error, onSandboxBlocked, {
            toolName: "read_file",
            toolCallId,
            input,
            retry: () => readTextFile(cwd, relativePath, mode, true),
          });
        }
      },
    }),
    search_files: tool({
      description: `按文件名模式或文本关键词搜索文件，query 支持不区分大小写的关键词匹配。Git workspace 遵循 .gitignore，非 Git workspace 跳过 .git、node_modules、target、dist。${pathScope}`,
      inputSchema: z.object({
        path: z.string().optional(),
        pattern: z.string().optional(),
        query: z.string().optional().describe("要查找的不区分大小写文本关键词"),
        maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
      }),
      execute: async (options, { toolCallId }) => {
        try {
          return await searchFiles(cwd, options, mode, approvedToolCallIds.has(toolCallId));
        } catch (error) {
          return retryAfterSandboxReview(error, onSandboxBlocked, {
            toolName: "search_files",
            toolCallId,
            input: options,
            retry: () => searchFiles(cwd, options, mode, true),
          });
        }
      },
    }),
    write_file: tool({
      description: `创建或覆盖文本文件。${pathScope}`,
      inputSchema: z.object({ path: z.string().min(1), content: z.string() }),
      execute: async ({ path: relativePath, content }, { toolCallId }) => {
        const input = { path: relativePath, content };
        const write = async (allowOutside: boolean) => {
          const root = rootPath(cwd);
          const target = resolveTarget(root, relativePath, mode, allowOutside);
          await writeFile(target, content, "utf8");
          return { path: path.relative(root, target), bytes: Buffer.byteLength(content) };
        };
        try {
          return await write(approvedToolCallIds.has(toolCallId));
        } catch (error) {
          return retryAfterSandboxReview(error, onSandboxBlocked, {
            toolName: "write_file",
            toolCallId,
            input,
            retry: () => write(true),
          });
        }
      },
    }),
    edit_file: tool({
      description: `将文件中唯一匹配的文本替换为新内容。${pathScope}`,
      inputSchema: z.object({
        path: z.string().min(1),
        oldText: z.string().min(1),
        newText: z.string(),
      }),
      execute: async ({ path: relativePath, oldText, newText }, { toolCallId }) => {
        const input = { path: relativePath, oldText, newText };
        const edit = async (allowOutside: boolean) => {
          const root = rootPath(cwd);
          const target = resolveTarget(root, relativePath, mode, allowOutside);
          const content = await readFile(target, "utf8");
          const count = content.split(oldText).length - 1;
          if (count !== 1)
            throw new Error(count === 0 ? "未找到要替换的文本" : "oldText 必须只匹配一次");
          await writeFile(target, content.replace(oldText, newText), "utf8");
          return { path: path.relative(root, target), changed: true };
        };
        try {
          return await edit(approvedToolCallIds.has(toolCallId));
        } catch (error) {
          return retryAfterSandboxReview(error, onSandboxBlocked, {
            toolName: "edit_file",
            toolCallId,
            input,
            retry: () => edit(true),
          });
        }
      },
    }),
    bash: tool({
      description: `执行 Bash 命令。${pathScope}完全访问模式支持外部 Bash cwd。源码或文件名搜索必须使用 search_files；不要用 grep/find/rg 递归扫描 workspace，尤其不要扫描 node_modules、.git、dist 或 target。Bash 适合运行测试、构建、Git 状态等命令。`,
      inputSchema: z.object({
        command: z.string().min(1),
        cwd: z.string().optional().describe("可选的 Bash 工作目录；完全访问模式支持外部绝对路径"),
      }),
      execute: async ({ command, cwd: requestedCwd }, { toolCallId }) => {
        const input = { command, cwd: requestedCwd };
        const run = async (allowOutside: boolean) => {
          const commandCwd = resolveCommandCwd(cwd, requestedCwd, mode, allowOutside);
          const result = await runSandboxedShell(command, { cwd: commandCwd, mode, allowOutside });
          if (result.sandboxBlocked) throw new SandboxBlockedError(result.out);
          return result;
        };
        try {
          return await run(approvedToolCallIds.has(toolCallId));
        } catch (error) {
          return retryAfterSandboxReview(error, onSandboxBlocked, {
            toolName: "bash",
            toolCallId,
            input,
            retry: () => run(true),
          });
        }
      },
    }),
  };
  return tools;
}

async function retryAfterSandboxReview<T>(
  error: unknown,
  onSandboxBlocked: SandboxEscalationHandler | undefined,
  options: {
    toolName: string;
    toolCallId?: string;
    input: unknown;
    retry: () => Promise<T>;
  },
): Promise<T> {
  if (!(error instanceof SandboxBlockedError) || !onSandboxBlocked) throw error;
  const decision = await onSandboxBlocked(options);
  if (!decision.approved) throw new SandboxBlockedError("被沙箱拦截了");
  return options.retry();
}
