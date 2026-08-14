import { execFile } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type {
  WorkspaceGitCommitResult,
  WorkspaceGitDiff,
  WorkspaceGitFile,
  WorkspaceGitSummary,
} from "@chatdesk/shared";

type GitStatusFile = {
  status: WorkspaceGitFile["status"];
  previousPath?: string;
};

type GitStatusValues = {
  isRepository: true;
  branch: string | null;
  ahead: number;
  behind: number;
  staged: number;
  modified: number;
  untracked: number;
  conflicted: number;
  clean: boolean;
};

export type GitStatusSnapshot = GitStatusValues & {
  files: Map<string, GitStatusFile>;
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

async function readGitSnapshot(root: string, filePath: string) {
  try {
    const result = await runGit(root, ["show", `HEAD:${filePath}`], MAX_GIT_DIFF_BYTES + 1);
    return result.stdout;
  } catch {
    return "";
  }
}

async function readWorkingSnapshot(root: string, filePath: string) {
  try {
    const metadata = await stat(path.join(root, filePath));
    if (metadata.size > MAX_GIT_DIFF_BYTES) return null;
    return await readFile(path.join(root, filePath), "utf8");
  } catch {
    return "";
  }
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

function parseBranchHeader(value: string) {
  const tracking = value.slice(3);
  const noCommits = tracking.match(/^No commits yet on (.+)$/);
  const branch = noCommits?.[1] ?? tracking.split("...")[0].split(" [ahead")[0] ?? null;
  let ahead = 0;
  let behind = 0;
  const details = tracking.match(/\[(.*?)\]/)?.[1] ?? "";
  for (const item of details.split(", ")) {
    const [kind, count] = item.split(/\s+/);
    if (kind === "ahead") ahead = Number(count) || 0;
    if (kind === "behind") behind = Number(count) || 0;
  }
  return { branch, ahead, behind };
}

function parseNumstat(output: string) {
  return output
    .split("\0")
    .filter(Boolean)
    .flatMap((record) => {
      const fields = record.split("\t");
      if (fields.length < 3) return [];
      const additions = fields[0] === "-" ? null : Number(fields[0]);
      const deletions = fields[1] === "-" ? null : Number(fields[1]);
      return [
        {
          path: fields[2],
          additions,
          deletions,
          binary: additions === null,
        },
      ];
    });
}

export async function readGitStatus(root: string): Promise<GitStatusSnapshot> {
  const result = await runGit(root, [
    "status",
    "--porcelain=v1",
    "--branch",
    "--untracked-files=all",
    "-z",
  ]);
  const tokens = result.stdout.split("\0").filter(Boolean);
  let branch: string | null = null;
  let ahead = 0;
  let behind = 0;
  let staged = 0;
  let modified = 0;
  let untracked = 0;
  let conflicted = 0;
  const files = new Map<string, GitStatusFile>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.startsWith("## ")) {
      ({ branch, ahead, behind } = parseBranchHeader(token));
      continue;
    }
    if (token.length < 4) continue;
    const status = token.slice(0, 2);
    const pathValue = token.slice(3);
    const fileStatus = statusForPath(status);
    let previousPath: string | undefined;
    if (status.includes("R") || status.includes("C")) {
      previousPath = tokens[index + 1];
      index += 1;
    }
    files.set(pathValue, { status: fileStatus, previousPath });
    if (status === "??") {
      untracked += 1;
      continue;
    }
    if (status[0] === "U" || status[1] === "U" || (status[0] === "A" && status[1] === "A")) {
      conflicted += 1;
      continue;
    }
    if (status[0] !== " ") staged += 1;
    if (status[1] !== " ") modified += 1;
  }

  return {
    isRepository: true,
    branch,
    ahead,
    behind,
    staged,
    modified,
    untracked,
    conflicted,
    clean: staged === 0 && modified === 0 && untracked === 0 && conflicted === 0,
    files,
  };
}

export async function collectGitSummary(
  root: string,
  status: GitStatusSnapshot,
): Promise<WorkspaceGitSummary> {
  const numstat = await runGit(root, [
    "diff",
    "--no-ext-diff",
    "--no-renames",
    "--numstat",
    "-z",
    "HEAD",
    "--",
  ]).catch(() => ({ stdout: "" }));
  const entries = new Map<string, WorkspaceGitFile>();
  for (const item of parseNumstat(numstat.stdout)) {
    const statusEntry = status.files.get(item.path);
    entries.set(item.path, {
      ...item,
      status: statusEntry?.status ?? "modified",
    });
  }
  for (const [relativePath, statusEntry] of status.files) {
    if (statusEntry.status !== "untracked" || entries.has(relativePath)) continue;
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
  for (const [filePath, statusEntry] of status.files) {
    if (!entries.has(filePath) && statusEntry.status !== "untracked") {
      entries.set(filePath, {
        path: filePath,
        status: statusEntry.status,
        additions: 0,
        deletions: 0,
        previousPath: statusEntry.previousPath,
      });
    }
  }
  for (const [filePath, statusEntry] of status.files) {
    if (!statusEntry.previousPath) continue;
    const current = entries.get(filePath);
    const previous = entries.get(statusEntry.previousPath);
    entries.set(filePath, {
      path: filePath,
      status: "renamed",
      additions: current?.additions ?? 0,
      deletions: previous?.deletions ?? current?.deletions ?? 0,
      previousPath: statusEntry.previousPath,
      binary: current?.binary || previous?.binary,
    });
    entries.delete(statusEntry.previousPath);
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
  const status = await readGitStatus(root);
  const statusEntry = status.files.get(safePath);
  const numstat = await runGit(root, [
    "diff",
    "--no-ext-diff",
    "--no-renames",
    "--numstat",
    "-z",
    "HEAD",
    "--",
    safePath,
    ...(statusEntry?.previousPath ? [statusEntry.previousPath] : []),
  ]).catch(() => ({ stdout: "" }));
  const numstats = parseNumstat(numstat.stdout);
  const file = numstats.find((item) => item.path === safePath);
  const previousFile = statusEntry?.previousPath
    ? numstats.find((item) => item.path === statusEntry.previousPath)
    : undefined;
  const fileStatus = statusEntry?.status ?? "modified";
  const additions = file?.additions ?? (fileStatus === "untracked" ? 0 : null);
  const deletions = file?.deletions ?? previousFile?.deletions ?? 0;
  let content = "";
  let binary = file?.binary;
  if (fileStatus === "untracked") {
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
  const originalContent = binary
    ? undefined
    : await readGitSnapshot(root, statusEntry?.previousPath ?? safePath);
  const modifiedContent = binary ? undefined : await readWorkingSnapshot(root, safePath);
  if (modifiedContent === null) truncated = true;
  return {
    path: safePath,
    previousPath: statusEntry?.previousPath,
    content,
    originalContent,
    modifiedContent: modifiedContent ?? undefined,
    additions,
    deletions,
    binary,
    truncated,
  };
}

export async function restoreGit(root: string, relativePath?: string): Promise<void> {
  if (relativePath?.trim()) {
    const safePath = safeRelativePath(root, relativePath);
    const status = await readGitStatus(root);
    const statusEntry = status.files.get(safePath);
    if (!statusEntry) return;
    if (statusEntry.status === "untracked") {
      await runGit(root, ["clean", "-fd", "--", safePath]);
      return;
    }
    if (statusEntry.status === "added") {
      await runGit(root, ["reset", "HEAD", "--", safePath]);
      await runGit(root, ["clean", "-fd", "--", safePath]);
      return;
    }
    const paths = [safePath];
    if (statusEntry.previousPath) {
      paths.unshift(safeRelativePath(root, statusEntry.previousPath));
    }
    await runGit(root, ["restore", "--source=HEAD", "--staged", "--worktree", "--", ...paths]);
    return;
  }
  await runGit(root, ["reset", "--hard", "HEAD"]);
  await runGit(root, ["clean", "-fd"]);
}

export async function commitGit(
  root: string,
  message?: string,
  push = false,
): Promise<WorkspaceGitCommitResult> {
  const commitMessage = message?.trim();
  if (!commitMessage) throw new Error("提交信息不能为空");
  await runGit(root, ["add", "-A"]);
  const status = await runGit(root, ["status", "--porcelain"]);
  if (!status.stdout.trim()) throw new Error("当前没有可提交的改动");
  await runGit(root, ["commit", "-m", commitMessage]);
  const hash = (await runGit(root, ["rev-parse", "HEAD"])).stdout.trim();
  if (push) await runGit(root, ["push"]);
  return { hash, message: commitMessage, pushed: push, generated: false };
}

export async function pushGit(root: string): Promise<WorkspaceGitCommitResult> {
  await runGit(root, ["push"]);
  const hash = (await runGit(root, ["rev-parse", "HEAD"])).stdout.trim();
  return { hash, message: "", pushed: true, generated: false };
}
