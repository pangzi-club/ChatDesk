import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceGitDiff, WorkspaceGitFile, WorkspaceGitSummary } from "@chatdesk/shared";

type GitStatus = {
  branch: string | null;
  ahead: number;
  behind: number;
};

const execFileAsync = promisify(execFile);
export const MAX_GIT_FILES = 200;
export const MAX_GIT_DIFF_BYTES = 128 * 1024;
const MAX_GIT_RESPONSE_BYTES = 1024 * 1024;

async function runGit(root: string, args: string[], maxBuffer = MAX_GIT_RESPONSE_BYTES) {
  return execFileAsync("git", args, {
    cwd: root,
    timeout: 8_000,
    maxBuffer,
  });
}

function safeRelativePath(root: string, relativePath: string) {
  const candidate = path.resolve(root, relativePath.trim());
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("路径必须位于当前 workspace 内");
  }
  return relative;
}

function countLines(value: string) {
  if (!value) return 0;
  return value.split(/\r?\n/).length - (value.endsWith("\n") ? 1 : 0);
}

function statusForPath(status: string): WorkspaceGitFile["status"] {
  if (status.includes("U")) return "conflicted";
  if (status.includes("?") || status === "??") return "untracked";
  if (status.includes("R")) return "renamed";
  if (status.includes("A")) return "added";
  if (status.includes("D")) return "deleted";
  return "modified";
}

function parseStatusPaths(output: string) {
  const result = new Map<string, WorkspaceGitFile["status"]>();
  for (const line of output.split(/\r?\n/)) {
    if (line.length < 3 || line.startsWith("## ")) continue;
    const status = line.slice(0, 2);
    const rawPath = line.slice(3);
    const [pathValue] = rawPath.split(" -> ").reverse();
    if (pathValue) result.set(pathValue, statusForPath(status));
  }
  return result;
}

function parseNumstat(output: string) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const fields = line.split("\t");
      if (fields.length < 3) return [];
      const additions = fields[0] === "-" ? null : Number(fields[0]);
      const deletions = fields[1] === "-" ? null : Number(fields[1]);
      const pathValue = fields[2];
      return [
        {
          path: fields[3] ?? pathValue,
          previousPath: fields[3] ? pathValue : undefined,
          additions,
          deletions,
          binary: additions === null,
        },
      ];
    });
}

export async function collectGitSummary(
  root: string,
  status: GitStatus,
): Promise<WorkspaceGitSummary> {
  const statusOutput = await runGit(root, ["status", "--short", "--branch"]).catch(() => ({
    stdout: "",
  }));
  const statuses = parseStatusPaths(statusOutput.stdout);
  const numstat = await runGit(root, [
    "diff",
    "--no-ext-diff",
    "--find-renames",
    "--numstat",
    "HEAD",
    "--",
  ]).catch(() => ({ stdout: "" }));
  const entries = new Map<string, WorkspaceGitFile>();
  for (const item of parseNumstat(numstat.stdout)) {
    entries.set(item.path, {
      ...item,
      status: statuses.get(item.path) ?? (item.previousPath ? "renamed" : "modified"),
    });
  }
  const untracked = await runGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]).catch(
    () => ({ stdout: "" }),
  );
  for (const relativePath of untracked.stdout.split("\0").filter(Boolean)) {
    if (entries.has(relativePath)) continue;
    try {
      const content = await readFile(path.join(root, relativePath), "utf8");
      entries.set(relativePath, {
        path: relativePath,
        status: "untracked",
        additions: countLines(content),
        deletions: 0,
      });
    } catch {
      entries.set(relativePath, {
        path: relativePath,
        status: "untracked",
        additions: null,
        deletions: null,
        binary: true,
      });
    }
  }
  for (const [filePath, fileStatus] of statuses) {
    if (!entries.has(filePath) && fileStatus !== "untracked") {
      entries.set(filePath, {
        path: filePath,
        status: fileStatus,
        additions: 0,
        deletions: 0,
      });
    }
  }
  const allFiles = [...entries.values()];
  const files = allFiles.slice(0, MAX_GIT_FILES);
  return {
    branch: status.branch,
    upstream: null,
    ahead: status.ahead,
    behind: status.behind,
    insertions: allFiles.reduce((sum, file) => sum + (file.additions ?? 0), 0),
    deletions: allFiles.reduce((sum, file) => sum + (file.deletions ?? 0), 0),
    filesChanged: entries.size,
    files,
    truncated: entries.size > files.length,
  };
}

export async function readGitDiff(root: string, relativePath: string): Promise<WorkspaceGitDiff> {
  const safePath = safeRelativePath(root, relativePath);
  const statusOutput = await runGit(root, ["status", "--short", "--branch"]);
  const statuses = parseStatusPaths(statusOutput.stdout);
  const numstat = await runGit(root, [
    "diff",
    "--no-ext-diff",
    "--find-renames",
    "--numstat",
    "HEAD",
    "--",
    safePath,
  ]).catch(() => ({ stdout: "" }));
  const file = parseNumstat(numstat.stdout)[0];
  const status = statuses.get(safePath) ?? (file?.previousPath ? "renamed" : "modified");
  const additions = file?.additions ?? (status === "untracked" ? 0 : null);
  const deletions = file?.deletions ?? 0;
  let content = "";
  let binary = file?.binary;
  if (status === "untracked") {
    try {
      const metadata = await stat(path.join(root, safePath));
      if (metadata.size <= MAX_GIT_DIFF_BYTES) {
        const source = await readFile(path.join(root, safePath), "utf8");
        content = source
          .split(/\r?\n/)
          .map((line) => `+${line}`)
          .join("\n");
        binary = false;
      } else {
        binary = true;
      }
    } catch {
      binary = true;
    }
  } else {
    const result = await runGit(
      root,
      ["diff", "--no-ext-diff", "--find-renames", "--unified=80", "HEAD", "--", safePath],
      MAX_GIT_DIFF_BYTES + 64 * 1024,
    ).catch(() => ({ stdout: "" }));
    content = result.stdout;
  }
  let truncated = false;
  if (Buffer.byteLength(content, "utf8") > MAX_GIT_DIFF_BYTES) {
    content = Buffer.from(content, "utf8").subarray(0, MAX_GIT_DIFF_BYTES).toString("utf8");
    truncated = true;
  }
  return {
    path: safePath,
    previousPath: file?.previousPath,
    content,
    additions,
    deletions,
    binary,
    truncated,
  };
}

export async function restoreGit(root: string, relativePath?: string): Promise<void> {
  if (relativePath?.trim()) {
    const safePath = safeRelativePath(root, relativePath);
    const statusOutput = await runGit(root, ["status", "--short", "--", safePath]);
    const status =
      statusOutput.stdout
        .split(/\r?\n/)
        .find((line) => line && !line.startsWith("## "))
        ?.slice(0, 2) ?? "";
    if (status === "??") {
      await runGit(root, ["clean", "-fd", "--", safePath]);
      return;
    }
    if (status.startsWith("A")) {
      await runGit(root, ["reset", "HEAD", "--", safePath]);
      await runGit(root, ["clean", "-fd", "--", safePath]);
      return;
    }
    const paths = [safePath];
    if (status.includes("R")) {
      const renameOutput = await runGit(root, ["status", "--short", "--", safePath]);
      const rawPath = renameOutput.stdout
        .split(/\r?\n/)
        .find((line) => line && !line.startsWith("## "))
        ?.slice(3);
      const previousPath = rawPath?.split(" -> ")[0];
      if (previousPath) paths.unshift(safeRelativePath(root, previousPath));
    }
    await runGit(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths]);
    return;
  }
  await runGit(root, ["reset", "--hard", "HEAD"]);
  await runGit(root, ["clean", "-fd"]);
}
