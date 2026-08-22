import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { buildEditFailureMessage } from "./file-edit.ts";
import { type ReadFileOptions, type ReadFileResult, readTextFileRange } from "./file-read.ts";
import { type FileSearchResult, MAX_SEARCH_RESULTS, searchWorkspaceFiles } from "./file-search.ts";
import type { JobRegistry } from "./job-registry.ts";
import type { SandboxMode } from "./protocol.ts";
import { classifySandboxBoundary } from "./sandbox-boundary-reviewer.ts";
import {
  isFilesystemSandboxDenial,
  isNetworkSandboxDenial,
  resolveCommandCwd,
  runSandboxedFile,
  runSandboxedShell,
  SandboxBlockedError,
  SandboxPathError,
  sandboxBlockedErrorFromShell,
} from "./sandbox-exec.ts";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "target", "dist"]);
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const MAX_PATCH_BYTES = 256 * 1024;

type SandboxEscalationHandler = (toolCall: {
  toolName: string;
  toolCallId?: string;
  input: unknown;
  errorReason?: string;
}) => Promise<{ approved: boolean; reason?: string }>;
export type ReadOnlyToolResultHandler = (
  toolName: "list_dir" | "search_files" | "read_file",
  input: unknown,
  output: unknown,
  toolCallId: string,
) => unknown;
type DirectoryResult = {
  path: string;
  entries: Array<{ name: string; path: string; kind: "dir" | "file" | "other" }>;
  totalEntries: number;
  truncated: boolean;
  nextOffset?: number;
};
type ApplyPatchResult = {
  changedFiles: string[];
  stats: Array<{ path: string; additions: number | null; deletions: number | null }>;
};
export type WorkspaceToolPreflight =
  | { status: "ok"; result: unknown }
  | { status: "error"; error: unknown }
  | { status: "sandbox-blocked"; error: SandboxBlockedError };

export type WorkspaceToolPreflightMap = Map<string, WorkspaceToolPreflight>;

export function resolveApprovedBashPermissions(
  input: { command: string; cwd?: string },
  workspace: string,
  readablePaths: string[],
  approved: boolean,
) {
  const assessment = classifySandboxBoundary({ toolName: "bash", input }, workspace, readablePaths);
  return {
    allowOutside:
      approved &&
      assessment.reasons.some((reason) => reason === "external-path" || reason === "external-cwd"),
    allowNetwork: approved && assessment.reasons.includes("network"),
  };
}

export function resolveBashRetryPermissions(
  input: { command: string; cwd?: string },
  workspace: string,
  readablePaths: string[],
  error: unknown,
) {
  const classified = resolveApprovedBashPermissions(input, workspace, readablePaths, true);
  const denialKind = error instanceof SandboxBlockedError ? error.denialKind : undefined;
  const output = error instanceof Error ? error.message : String(error);
  if (denialKind === "network" || isNetworkSandboxDenial(output)) {
    return { allowOutside: false, allowNetwork: true };
  }
  return {
    allowOutside:
      classified.allowOutside || denialKind === "filesystem" || isFilesystemSandboxDenial(output),
    allowNetwork: false,
  };
}

export async function preflightWorkspaceTool(options: {
  toolName: string;
  input: unknown;
  cwd: string;
  mode: SandboxMode;
  readablePaths?: string[];
  developerToolPaths?: string[];
}): Promise<WorkspaceToolPreflight> {
  const readablePaths = options.readablePaths ?? [];
  try {
    if (options.toolName === "list_dir") {
      const input = options.input as { path?: string; offset?: number; limit?: number };
      return {
        status: "ok",
        result: await listDirectory(
          options.cwd,
          input.path,
          options.mode,
          false,
          readablePaths,
          input.offset,
          input.limit,
        ),
      };
    }
    if (options.toolName === "read_file") {
      const input = options.input as { path: string } & ReadFileOptions;
      return {
        status: "ok",
        result: await readTextFile(
          options.cwd,
          input.path,
          options.mode,
          false,
          readablePaths,
          input,
        ),
      };
    }
    if (options.toolName === "search_files") {
      return {
        status: "ok",
        result: await searchFiles(
          options.cwd,
          options.input as { path?: string; pattern?: string; query?: string; maxResults?: number },
          options.mode,
          false,
          readablePaths,
          options.developerToolPaths,
        ),
      };
    }
    if (options.toolName === "bash") {
      const input = options.input as { command: string; cwd?: string };
      const commandCwd = resolveCommandCwd(options.cwd, input.cwd, options.mode, false);
      const result = await runSandboxedShell(input.command, {
        cwd: commandCwd,
        mode: options.mode,
        readablePaths,
        developerToolPaths: options.developerToolPaths,
      });
      if (result.sandboxBlocked) throw sandboxBlockedErrorFromShell(input.command, result);
      return { status: "ok", result };
    }
    return { status: "error", error: new Error(`不支持对 ${options.toolName} 做沙箱预执行`) };
  } catch (error) {
    if (error instanceof SandboxBlockedError) return { status: "sandbox-blocked", error };
    return { status: "error", error };
  }
}
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
    throw new SandboxPathError("路径必须是 workspace 内的相对路径，或位于已配置的读取白名单目录内");
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

function isWithinWorkspace(root: string, target: string) {
  return target === root || target.startsWith(`${root}${path.sep}`);
}

function resolveReadableTarget(
  root: string,
  candidate: string,
  mode: SandboxMode,
  allowOutside: boolean,
  readablePaths: string[],
) {
  if (mode === "full" || allowOutside) return resolveTarget(root, candidate, mode, true);
  const trimmed = candidate.trim();
  const lexicalTarget = path.resolve(
    path.isAbsolute(trimmed) ? trimmed : path.resolve(root, trimmed),
  );
  const target = canonicalizeTarget(
    path.isAbsolute(trimmed) ? trimmed : path.resolve(root, trimmed),
  );
  if (lexicalTarget === root || lexicalTarget.startsWith(`${root}${path.sep}`)) return target;
  if (target === root || target.startsWith(`${root}${path.sep}`)) return target;
  const readableRoots = resolveReadableRoots(readablePaths);
  if (
    readableRoots.some(
      (directory) =>
        lexicalTarget === directory ||
        lexicalTarget.startsWith(`${directory}${path.sep}`) ||
        target === directory ||
        target.startsWith(`${directory}${path.sep}`),
    )
  ) {
    return target;
  }
  throw new SandboxPathError("路径不在 workspace 或沙箱读取白名单内；请改用 workspace 相对路径");
}

function displayPath(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : target;
}

function resolveReadableRoots(readablePaths: string[]) {
  return readablePaths.flatMap((value) => {
    const absolute = path.resolve(value.trim());
    if (!value.trim()) return [];
    const roots = [absolute];
    try {
      const resolved = realpathSync(absolute);
      if (resolved !== absolute) roots.push(resolved);
    } catch {
      // Keep non-existent configured paths out of runtime reads until they exist.
    }
    return roots;
  });
}

async function listDirectory(
  cwd: string,
  relativePath: string | undefined,
  mode: SandboxMode,
  allowOutside = false,
  readablePaths: string[] = [],
  offset = 0,
  limit = DEFAULT_LIST_LIMIT,
): Promise<DirectoryResult> {
  const root = rootPath(cwd);
  const target = resolveReadableTarget(
    root,
    relativePath || ".",
    mode,
    allowOutside,
    readablePaths,
  );
  if (mode !== "full" && !allowOutside) {
    const result = await runSandboxedFile(
      { operation: "list_dir", workspace: root, path: target, offset, limit, readablePaths },
      { mode },
    );
    if (result.sandboxBlocked) throw new SandboxBlockedError(result.error);
    if (!result.result) throw new Error(result.error);
    return result.result as DirectoryResult;
  }
  const entries = await readdir(target, { withFileTypes: true });
  const normalizedOffset = Math.max(0, offset);
  const normalizedLimit = Math.min(MAX_LIST_LIMIT, Math.max(1, limit));
  const visibleEntries = entries
    .filter((entry) => {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) return true;
      const readableRoots = resolveReadableRoots(readablePaths);
      const entryPath = path.resolve(target, entry.name);
      return readableRoots.some(
        (directory) => entryPath === directory || entryPath.startsWith(`${directory}${path.sep}`),
      );
    })
    .map((entry) => ({
      name: entry.name,
      path: displayPath(root, path.join(target, entry.name)),
      kind: (entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other") as
        | "dir"
        | "file"
        | "other",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const pagedEntries = visibleEntries.slice(normalizedOffset, normalizedOffset + normalizedLimit);
  const nextOffset = normalizedOffset + pagedEntries.length;
  return {
    path: displayPath(root, target),
    entries: pagedEntries,
    totalEntries: visibleEntries.length,
    truncated: nextOffset < visibleEntries.length,
    nextOffset: nextOffset < visibleEntries.length ? nextOffset : undefined,
  };
}

async function readTextFile(
  cwd: string,
  relativePath: string,
  mode: SandboxMode,
  allowOutside = false,
  readablePaths: string[] = [],
  options: ReadFileOptions = {},
): Promise<ReadFileResult> {
  const root = rootPath(cwd);
  const target = resolveReadableTarget(root, relativePath, mode, allowOutside, readablePaths);
  if (mode !== "full" && !allowOutside) {
    const result = await runSandboxedFile(
      { operation: "read_file", workspace: root, path: target, readablePaths, ...options },
      { mode },
    );
    if (result.sandboxBlocked) throw new SandboxBlockedError(result.error);
    if (!result.result) throw new Error(result.error);
    return result.result as ReadFileResult;
  }
  return readTextFileRange(target, displayPath(root, target), options);
}

async function searchFiles(
  cwd: string,
  options: { path?: string; pattern?: string; query?: string; maxResults?: number },
  mode: SandboxMode,
  allowOutside = false,
  readablePaths: string[] = [],
  developerToolPaths: string[] = [],
): Promise<FileSearchResult> {
  const root = rootPath(cwd);
  const start = resolveReadableTarget(root, options.path || ".", mode, allowOutside, readablePaths);
  if (mode !== "full" && !allowOutside) {
    const result = await runSandboxedFile(
      {
        operation: "search_files",
        workspace: root,
        ...options,
        path: start,
        readablePaths,
        developerToolPaths,
      },
      { mode },
    );
    if (result.sandboxBlocked) throw new SandboxBlockedError(result.error);
    if (!result.result) throw new Error(result.error);
    return result.result as FileSearchResult;
  }
  return searchWorkspaceFiles(root, start, options);
}

export function createWorkspaceTools(
  cwd: string,
  mode: SandboxMode = "ask",
  approvedToolCallIds = new Set<string>(),
  onSandboxBlocked?: SandboxEscalationHandler,
  readablePaths: string[] = [],
  preflightResults: WorkspaceToolPreflightMap = new Map(),
  developerToolPaths: string[] = [],
  onReadOnlyToolResult?: ReadOnlyToolResultHandler,
  jobs?: JobRegistry,
  sessionId?: string,
  runId?: string,
): ToolSet {
  const pathScope =
    mode === "full"
      ? "完全访问模式下也可使用外部绝对路径。"
      : readablePaths.length > 0
        ? "受限模式下路径必须位于当前 workspace 或沙箱读取白名单内；白名单目录只读。"
        : "受限模式下路径必须位于当前 workspace 内。";
  const tools: ToolSet = {
    list_dir: tool({
      description: `列出文件与子目录。${pathScope}`,
      inputSchema: z.object({
        path: z.string().optional(),
        offset: z.number().int().min(0).optional(),
        limit: z.number().int().min(1).max(MAX_LIST_LIMIT).optional(),
      }),
      execute: async ({ path: relativePath, offset, limit }, { toolCallId }) => {
        const input = { path: relativePath, offset, limit };
        const preflight = consumePreflight(preflightResults, toolCallId, approvedToolCallIds);
        if (preflight) {
          const output = await (resolvePreflight(preflight) as Promise<DirectoryResult>);
          return onReadOnlyToolResult?.("list_dir", input, output, toolCallId) ?? output;
        }
        try {
          const output = await listDirectory(
            cwd,
            relativePath,
            mode,
            approvedToolCallIds.has(toolCallId),
            readablePaths,
            offset,
            limit,
          );
          return onReadOnlyToolResult?.("list_dir", input, output, toolCallId) ?? output;
        } catch (error) {
          const output = await retryAfterSandboxReview(error, onSandboxBlocked, {
            toolName: "list_dir",
            toolCallId,
            input,
            retry: () => listDirectory(cwd, relativePath, mode, true, readablePaths, offset, limit),
          });
          return onReadOnlyToolResult?.("list_dir", input, output, toolCallId) ?? output;
        }
      },
    }),
    read_file: tool({
      description: `读取文本文件。单次最多返回 64 KiB；结果截断时使用 startLine/endLine 继续读取。${pathScope}`,
      inputSchema: z.object({
        path: z.string().min(1),
        startLine: z.number().int().positive().optional(),
        endLine: z.number().int().positive().optional(),
      }),
      execute: async ({ path: relativePath, startLine, endLine }, { toolCallId }) => {
        const input = { path: relativePath, startLine, endLine };
        const preflight = consumePreflight(preflightResults, toolCallId, approvedToolCallIds);
        if (preflight) {
          const output = await (resolvePreflight(preflight) as Promise<ReadFileResult>);
          return onReadOnlyToolResult?.("read_file", input, output, toolCallId) ?? output;
        }
        try {
          const output = await readTextFile(
            cwd,
            relativePath,
            mode,
            approvedToolCallIds.has(toolCallId),
            readablePaths,
            { startLine, endLine },
          );
          return onReadOnlyToolResult?.("read_file", input, output, toolCallId) ?? output;
        } catch (error) {
          const output = await retryAfterSandboxReview(error, onSandboxBlocked, {
            toolName: "read_file",
            toolCallId,
            input,
            retry: () =>
              readTextFile(cwd, relativePath, mode, true, readablePaths, { startLine, endLine }),
          });
          return onReadOnlyToolResult?.("read_file", input, output, toolCallId) ?? output;
        }
      },
    }),
    search_files: tool({
      description: `按 glob 文件名模式或文本关键词搜索文件，pattern 支持 **/*.ts，query 不区分大小写并返回首个命中行。Git workspace 遵循 .gitignore，非 Git workspace 跳过 .git、node_modules、target、dist。${pathScope}`,
      inputSchema: z.object({
        path: z.string().optional(),
        pattern: z.string().optional().describe("文件 glob，例如 **/*.ts 或 package*.json"),
        query: z.string().optional().describe("要查找的不区分大小写文本关键词"),
        maxResults: z.number().int().min(1).max(MAX_SEARCH_RESULTS).optional(),
      }),
      execute: async (options, { toolCallId }) => {
        const preflight = consumePreflight(preflightResults, toolCallId, approvedToolCallIds);
        if (preflight) {
          const output = await (resolvePreflight(preflight) as Promise<FileSearchResult>);
          return onReadOnlyToolResult?.("search_files", options, output, toolCallId) ?? output;
        }
        try {
          const output = await searchFiles(
            cwd,
            options,
            mode,
            approvedToolCallIds.has(toolCallId),
            readablePaths,
            developerToolPaths,
          );
          return onReadOnlyToolResult?.("search_files", options, output, toolCallId) ?? output;
        } catch (error) {
          const output = await retryAfterSandboxReview(error, onSandboxBlocked, {
            toolName: "search_files",
            toolCallId,
            input: options,
            retry: () => searchFiles(cwd, options, mode, true, readablePaths, developerToolPaths),
          });
          return onReadOnlyToolResult?.("search_files", options, output, toolCallId) ?? output;
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
          if (mode !== "full") {
            const outsideWorkspace = !isWithinWorkspace(root, target);
            const result = await runSandboxedFile(
              {
                operation: "write_file",
                workspace: root,
                path: target,
                content,
                allowOutside: outsideWorkspace,
              },
              {
                mode,
                readablePaths: outsideWorkspace ? [path.dirname(target)] : [],
                writablePaths: outsideWorkspace ? [target] : [],
              },
            );
            if (result.sandboxBlocked) throw new SandboxBlockedError(result.error);
            if (!result.result) throw new Error(result.error);
            return result.result as { path: string; bytes: number };
          }
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
          if (mode !== "full") {
            const outsideWorkspace = !isWithinWorkspace(root, target);
            const result = await runSandboxedFile(
              {
                operation: "edit_file",
                workspace: root,
                path: target,
                oldText,
                newText,
                allowOutside: outsideWorkspace,
              },
              {
                mode,
                readablePaths: outsideWorkspace ? [path.dirname(target)] : [],
                writablePaths: outsideWorkspace ? [target] : [],
              },
            );
            if (result.sandboxBlocked) throw new SandboxBlockedError(result.error);
            if (!result.result) throw new Error(result.error);
            return result.result as { path: string; changed: boolean };
          }
          const content = await readFile(target, "utf8");
          const count = content.split(oldText).length - 1;
          if (count !== 1) throw new Error(buildEditFailureMessage(content, oldText, count));
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
    apply_patch: tool({
      description: `应用 unified diff，可原子修改多个 workspace 文件。最大 256 KiB；不支持绝对路径、..、.git 或 binary patch。${pathScope}`,
      inputSchema: z.object({
        patch: z
          .string()
          .min(1)
          .refine((value) => Buffer.byteLength(value) <= MAX_PATCH_BYTES, {
            message: "patch 不能超过 256 KiB",
          }),
      }),
      execute: async ({ patch }) => {
        const root = rootPath(cwd);
        const result = await runSandboxedFile(
          { operation: "apply_patch", workspace: root, patch },
          { mode },
        );
        if (result.sandboxBlocked) throw new SandboxBlockedError(result.error);
        if (!result.result) throw new Error(result.error);
        return result.result as ApplyPatchResult;
      },
    }),
    bash: tool({
      description: `执行 Bash 命令。${pathScope}完全访问模式支持外部 Bash cwd。优先使用 search_files 搜索源码；若当前没有该工具，可使用 rg 并遵循 .gitignore，避免扫描 node_modules、.git、dist 或 target。Bash 也适合运行测试、构建、Git 状态等命令。`,
      inputSchema: z.object({
        command: z.string().min(1),
        cwd: z.string().optional().describe("可选的 Bash 工作目录；完全访问模式支持外部绝对路径"),
        block_until: z
          .number()
          .int()
          .min(0)
          .max(120_000)
          .optional()
          .describe("最多同步等待毫秒；0 立即转为后台 Job"),
      }),
      execute: async ({ command, cwd: requestedCwd, block_until }, { toolCallId }) => {
        const input = { command, cwd: requestedCwd };
        const approved = approvedToolCallIds.has(toolCallId);
        const approvedPreflight = toolCallId ? preflightResults.get(toolCallId) : undefined;
        const approvedPermissions =
          approved && approvedPreflight?.status === "sandbox-blocked"
            ? resolveBashRetryPermissions(input, cwd, readablePaths, approvedPreflight.error)
            : resolveApprovedBashPermissions(input, cwd, readablePaths, approved);
        const run = async (permissions: { allowOutside: boolean; allowNetwork: boolean }) => {
          const commandCwd = resolveCommandCwd(cwd, requestedCwd, mode, permissions.allowOutside);
          const result = await runSandboxedShell(command, {
            cwd: commandCwd,
            mode,
            allowOutside: permissions.allowOutside,
            allowNetwork: permissions.allowNetwork,
            readablePaths,
            developerToolPaths,
          });
          if (result.sandboxBlocked) throw sandboxBlockedErrorFromShell(command, result);
          return result;
        };
        if (jobs && sessionId && block_until !== undefined) {
          const commandCwd = resolveCommandCwd(
            cwd,
            requestedCwd,
            mode,
            approvedPermissions.allowOutside,
          );
          const job = await jobs.start({
            sessionId,
            ...(runId ? { runId } : {}),
            command,
            cwd: commandCwd,
            mode,
            allowOutside: approvedPermissions.allowOutside,
            allowNetwork: approvedPermissions.allowNetwork,
            readablePaths,
            developerToolPaths,
          });
          const waited = await jobs.wait(job.jobId, sessionId, block_until);
          if (["exited", "failed", "stopped", "timed_out", "interrupted"].includes(waited.status)) {
            const output = jobs.output(job.jobId, sessionId, 0);
            return {
              code: waited.exitCode ?? (waited.status === "exited" ? 0 : 1),
              out: output.output,
              success: waited.status === "exited",
              timedOut: waited.status === "timed_out",
              truncated: output.truncated,
              totalOutputBytes: output.outputBytes,
            };
          }
          return { jobId: job.jobId, status: waited.status, command, cwd: commandCwd };
        }
        const escalateSandboxBlock = (error: unknown) =>
          retryAfterSandboxReview(error, onSandboxBlocked, {
            toolName: "bash",
            toolCallId,
            input,
            retry: () => run(resolveBashRetryPermissions(input, cwd, readablePaths, error)),
          });
        const preflight = consumePreflight(preflightResults, toolCallId, approvedToolCallIds);
        if (preflight?.status === "sandbox-blocked") return escalateSandboxBlock(preflight.error);
        if (preflight) {
          return resolvePreflight(preflight) as Promise<{
            code: number;
            out: string;
            sandboxBlocked: boolean;
          }>;
        }
        try {
          return await run(approvedPermissions);
        } catch (error) {
          return escalateSandboxBlock(error);
        }
      },
    }),
    ...(jobs && sessionId
      ? {
          bash_wait: tool({
            description: "等待后台 Bash Job 状态变化或结束。",
            inputSchema: z.object({
              jobId: z.string().min(1),
              timeoutMs: z.number().int().min(0).max(60_000).optional(),
            }),
            execute: ({ jobId, timeoutMs }) => jobs.wait(jobId, sessionId, timeoutMs),
          }),
          bash_output: tool({
            description: "读取后台 Bash Job 的新增输出。",
            inputSchema: z.object({
              jobId: z.string().min(1),
              cursor: z.number().int().min(0).optional(),
            }),
            execute: ({ jobId, cursor }) => jobs.output(jobId, sessionId, cursor),
          }),
          bash_stop: tool({
            description: "停止后台 Bash Job 及其子进程。",
            inputSchema: z.object({ jobId: z.string().min(1) }),
            execute: ({ jobId }) => jobs.stop(jobId, sessionId),
          }),
        }
      : {}),
  };
  return tools;
}

function consumePreflight(
  preflightResults: WorkspaceToolPreflightMap,
  toolCallId: string | undefined,
  approvedToolCallIds: Set<string>,
) {
  if (!toolCallId) return undefined;
  const result = preflightResults.get(toolCallId);
  if (result) {
    preflightResults.delete(toolCallId);
    if (approvedToolCallIds.has(toolCallId) && result.status === "sandbox-blocked") {
      return undefined;
    }
  }
  if (approvedToolCallIds.has(toolCallId)) return undefined;
  return result;
}

function resolvePreflight(preflight: WorkspaceToolPreflight): Promise<unknown> {
  if (preflight.status === "ok") return Promise.resolve(preflight.result);
  if (preflight.status === "error") return Promise.reject(preflight.error);
  return Promise.reject(preflight.error);
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
  const decision = await onSandboxBlocked({
    ...options,
    errorReason: error.message,
  });
  if (!decision.approved) {
    throw new SandboxBlockedError(decision.reason?.trim() || error.message);
  }
  return options.retry();
}
