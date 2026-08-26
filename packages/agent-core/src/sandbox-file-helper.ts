import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildEditFailureMessage } from "./file-edit.ts";
import { readTextFileRange, resolveReadRange } from "./file-read.ts";
import { searchWorkspaceFiles } from "./file-search.ts";

const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "target", "dist"]);
const DEFAULT_LIST_LIMIT = 200;
const MAX_LIST_LIMIT = 500;
const MAX_PATCH_BYTES = 256 * 1024;

type Request =
  | {
      operation: "list_dir";
      workspace: string;
      path?: string;
      offset?: number;
      limit?: number;
      readablePaths?: string[];
    }
  | {
      operation: "read_file";
      workspace: string;
      path: string;
      startLine?: number;
      endLine?: number;
      offset?: number;
      limit?: number;
      view_range?: number[];
      readablePaths?: string[];
    }
  | {
      operation: "search_files";
      workspace: string;
      path?: string;
      pattern?: string;
      query?: string;
      include?: string;
      regex?: boolean;
      maxResults?: number;
      readablePaths?: string[];
      developerToolPaths?: string[];
    }
  | {
      operation: "write_file";
      workspace: string;
      path: string;
      content: string;
      allowOutside?: boolean;
    }
  | {
      operation: "edit_file";
      workspace: string;
      path: string;
      oldText: string;
      newText: string;
      replaceAll?: boolean;
      insertLine?: number;
      allowOutside?: boolean;
    }
  | {
      operation: "apply_patch";
      workspace: string;
      patch: string;
    };

function canonicalize(target: string) {
  const missing: string[] = [];
  let existing = target;
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missing.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(realpathSync(existing), ...missing);
}

function targetPath(request: Exclude<Request, { operation: "apply_patch" }>) {
  const root = realpathSync(request.workspace);
  const value = request.path?.trim() || ".";
  return { root, target: canonicalize(path.isAbsolute(value) ? value : path.resolve(root, value)) };
}

function displayPath(root: string, target: string) {
  const relative = path.relative(root, target);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : target;
}

function writeTargetPath(request: Extract<Request, { operation: "write_file" | "edit_file" }>) {
  const { root, target } = targetPath(request);
  if (!request.allowOutside && target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("写入路径必须位于 workspace 内");
  }
  return { root, target };
}

async function listDirectory(request: Extract<Request, { operation: "list_dir" }>) {
  const { root, target } = targetPath(request);
  const entries = await readdir(target, { withFileTypes: true });
  const readableRoots = (request.readablePaths ?? []).flatMap((value) => {
    if (!value.trim()) return [];
    try {
      return [canonicalize(path.resolve(value.trim()))];
    } catch {
      return [];
    }
  });
  const offset = Math.max(0, request.offset ?? 0);
  const limit = Math.min(MAX_LIST_LIMIT, Math.max(1, request.limit ?? DEFAULT_LIST_LIMIT));
  const visibleEntries = entries
    .filter((entry) => {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) return true;
      const entryPath = path.resolve(target, entry.name);
      return readableRoots.some(
        (directory) => entryPath === directory || entryPath.startsWith(`${directory}${path.sep}`),
      );
    })
    .map((entry) => ({
      name: entry.name,
      path: displayPath(root, path.join(target, entry.name)),
      kind: entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other",
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const pagedEntries = visibleEntries.slice(offset, offset + limit);
  const nextOffset = offset + pagedEntries.length;
  return {
    path: displayPath(root, target),
    entries: pagedEntries,
    totalEntries: visibleEntries.length,
    truncated: nextOffset < visibleEntries.length,
    nextOffset: nextOffset < visibleEntries.length ? nextOffset : undefined,
  };
}

async function readTextFile(request: Extract<Request, { operation: "read_file" }>) {
  const { root, target } = targetPath(request);
  return readTextFileRange(target, displayPath(root, target), resolveReadRange(request));
}

async function searchFiles(request: Extract<Request, { operation: "search_files" }>) {
  const { root, target: start } = targetPath(request);
  return searchWorkspaceFiles(root, start, request);
}

async function writeTextFile(request: Extract<Request, { operation: "write_file" }>) {
  const { root, target } = writeTargetPath(request);
  await writeFile(target, request.content, "utf8");
  return { path: displayPath(root, target), bytes: Buffer.byteLength(request.content) };
}

async function editTextFile(request: Extract<Request, { operation: "edit_file" }>) {
  const { root, target } = writeTargetPath(request);
  const content = await readFile(target, "utf8");
  if (request.insertLine !== undefined) {
    const lines = content.split(/\r?\n/);
    if (request.insertLine > lines.length) {
      throw new Error(`insertLine 必须在 0-${lines.length} 之间`);
    }
    lines.splice(request.insertLine, 0, request.newText);
    await writeFile(target, lines.join("\n"), "utf8");
    return { path: displayPath(root, target), changed: true };
  }
  const count = content.split(request.oldText).length - 1;
  if (!request.replaceAll && count !== 1) {
    throw new Error(buildEditFailureMessage(content, request.oldText, count));
  }
  await writeFile(
    target,
    request.replaceAll
      ? content.replaceAll(request.oldText, request.newText)
      : content.replace(request.oldText, request.newText),
    "utf8",
  );
  return { path: displayPath(root, target), changed: true };
}

function validatePatch(patch: string) {
  if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) throw new Error("patch 不能超过 256 KiB");
  if (/^GIT binary patch$/m.test(patch) || /^Binary files .* differ$/m.test(patch)) {
    throw new Error("不支持 binary patch");
  }
  const paths: string[] = [];
  for (const line of patch.split("\n")) {
    const diffMatch = line.match(/^diff --git (.+) (.+)$/);
    const fileMatch = line.match(/^(?:---|\+\+\+)\s+([^\t]+)(?:\t.*)?$/);
    const metadataMatch = line.match(/^(?:rename|copy) (?:from|to) (.+)$/);
    if (diffMatch) paths.push(diffMatch[1], diffMatch[2]);
    else if (fileMatch) paths.push(fileMatch[1]);
    else if (metadataMatch) paths.push(metadataMatch[1]);
  }
  if (paths.length === 0) throw new Error("patch 必须是 unified diff");
  for (const rawPath of paths) {
    if (rawPath === "/dev/null") continue;
    const unquoted =
      rawPath.startsWith('"') && rawPath.endsWith('"') ? rawPath.slice(1, -1) : rawPath;
    const value = unquoted.replace(/^(?:a|b)\//, "");
    if (path.isAbsolute(value) || value.split(/[\\/]/).includes("..")) {
      throw new Error("patch 路径必须位于 workspace 内");
    }
    if (value.split(/[\\/]/).includes(".git")) throw new Error("patch 不允许修改 .git");
  }
}

async function runGitApply(workspace: string, args: string[], patch: string) {
  return new Promise<{ code: number; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn("git", ["apply", ...args, "-"], {
      cwd: workspace,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.stdin.end(patch);
  });
}

function parseNumstat(output: string) {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [additions, deletions, ...pathParts] = line.split("\t");
      return {
        path: pathParts.join("\t"),
        additions: additions === "-" ? null : Number(additions),
        deletions: deletions === "-" ? null : Number(deletions),
      };
    });
}

async function applyPatch(request: Extract<Request, { operation: "apply_patch" }>) {
  validatePatch(request.patch);
  const root = realpathSync(request.workspace);
  const check = await runGitApply(root, ["--check", "--whitespace=nowarn"], request.patch);
  if (check.code !== 0) throw new Error(check.stderr.trim() || "patch 检查失败");
  const numstat = await runGitApply(root, ["--numstat"], request.patch);
  if (numstat.code !== 0) throw new Error(numstat.stderr.trim() || "无法读取 patch 统计");
  const applied = await runGitApply(root, ["--whitespace=nowarn"], request.patch);
  if (applied.code !== 0) throw new Error(applied.stderr.trim() || "patch 应用失败");
  const stats = parseNumstat(numstat.stdout);
  return { changedFiles: stats.map((item) => item.path), stats };
}

export async function runSandboxFileHelper() {
  const input = await new Promise<string>((resolve, reject) => {
    let value = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (value += chunk));
    process.stdin.once("end", () => resolve(value));
    process.stdin.once("error", reject);
  });
  const request = JSON.parse(input) as Request;
  const result =
    request.operation === "list_dir"
      ? await listDirectory(request)
      : request.operation === "read_file"
        ? await readTextFile(request)
        : request.operation === "search_files"
          ? await searchFiles(request)
          : request.operation === "write_file"
            ? await writeTextFile(request)
            : request.operation === "edit_file"
              ? await editTextFile(request)
              : await applyPatch(request);
  process.stdout.write(JSON.stringify({ ok: true, result }));
}
