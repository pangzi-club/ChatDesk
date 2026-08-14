import { execFile } from "node:child_process";
import { existsSync, realpathSync, statSync } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { SandboxMode } from "../protocol.ts";
import { resolveCommandCwd, runSandboxedShell } from "../sandbox-exec.ts";
import {
  collectGitSummary,
  commitGit,
  pushGit,
  readGitDiff,
  readGitStatus,
  restoreGit,
} from "./git.ts";
import type {
  PlatformAdapter,
  PlatformCapabilities,
  ViteProcess,
  WorkspaceGitInfo,
  WorkspaceListResult,
  WorkspaceReadResult,
} from "./types.ts";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 512 * 1024;
const MAX_SEARCH_RESULTS = 500;
const SKIPPED_DIRECTORIES = new Set([".git", "node_modules", "target", "dist"]);
const SKIPPED_FILES = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

function canonicalizeTarget(target: string) {
  const missingParts: string[] = [];
  let existing = target;
  while (!existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    missingParts.unshift(path.basename(existing));
    existing = parent;
  }
  return path.resolve(realpathSync(existing), ...missingParts);
}

function withinRoot(root: string, candidate: string) {
  const resolved = canonicalizeTarget(path.resolve(root, candidate || "."));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("路径必须位于当前 workspace 内");
  }
  return resolved;
}

function rootPath(value: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("workspace 路径不能为空");
  try {
    const root = realpathSync(trimmed);
    if (!statSyncDirectory(root)) throw new Error("workspace 不是目录");
    return root;
  } catch {
    throw new Error(`workspace 不存在：${trimmed}`);
  }
}

function statSyncDirectory(value: string) {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}

function capabilities(): PlatformCapabilities {
  return {
    platform: process.platform,
    git: true,
    shell: true,
    restrictedShell: process.platform === "darwin",
    processManagement: process.platform !== "win32",
  };
}

async function inspectGit(root: string): Promise<WorkspaceGitInfo> {
  try {
    const parsed = await readGitStatus(root);
    const log = await execFileAsync(
      "git",
      ["log", "-10", "--date=iso-strict", "--format=%H%x1f%h%x1f%an%x1f%ad%x1f%s"],
      { cwd: root, timeout: 5_000, maxBuffer: 2 * 1024 * 1024 },
    ).catch(() => ({ stdout: "" }));
    return {
      pathExists: true,
      isRepository: true,
      status: {
        isRepository: parsed.isRepository,
        branch: parsed.branch,
        ahead: parsed.ahead,
        behind: parsed.behind,
        staged: parsed.staged,
        modified: parsed.modified,
        untracked: parsed.untracked,
        conflicted: parsed.conflicted,
        clean: parsed.clean,
      },
      commits: parseGitCommits(log.stdout),
      error: null,
      summary: await collectGitSummary(root, parsed),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not a git repository")) {
      return {
        pathExists: true,
        isRepository: false,
        status: null,
        commits: [],
        error: null,
        summary: null,
      };
    }
    return {
      pathExists: true,
      isRepository: false,
      status: null,
      commits: [],
      error: message,
      summary: null,
    };
  }
}

function parseGitCommits(output: string) {
  return output
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => line.split("\u001f"))
    .filter((fields) => fields.length >= 5)
    .map(([hash, shortHash, author, date, ...subject]) => ({
      hash,
      shortHash,
      author,
      date,
      subject: subject.join("\u001f"),
    }));
}

export class NodePlatformAdapter implements PlatformAdapter {
  capabilities() {
    return capabilities();
  }

  resolveWorkspace(value: string) {
    return rootPath(value);
  }

  async listDir(rootValue: string, relativePath = "."): Promise<WorkspaceListResult> {
    const root = rootPath(rootValue);
    const target = withinRoot(root, relativePath);
    const entries = await readdir(target, { withFileTypes: true });
    return {
      path: path.relative(root, target) || ".",
      entries: entries
        .filter(
          (entry) =>
            !SKIPPED_DIRECTORIES.has(entry.name) &&
            !(entry.isFile() && SKIPPED_FILES.has(entry.name)),
        )
        .map((entry) => ({
          name: entry.name,
          path: path.relative(root, path.join(target, entry.name)),
          kind: (entry.isDirectory() ? "dir" : entry.isFile() ? "file" : "other") as
            | "dir"
            | "file"
            | "other",
        }))
        .sort((a, b) => a.path.localeCompare(b.path)),
    };
  }

  async readFile(rootValue: string, relativePath: string): Promise<WorkspaceReadResult> {
    const root = rootPath(rootValue);
    const target = withinRoot(root, relativePath);
    const metadata = await stat(target);
    if (!metadata.isFile()) throw new Error("路径不是文件");
    if (metadata.size > MAX_FILE_BYTES) throw new Error("文件超过 512 KB，未读取");
    return { path: path.relative(root, target), content: await readFile(target, "utf8") };
  }

  async writeFile(rootValue: string, relativePath: string, content: string) {
    const root = rootPath(rootValue);
    const target = withinRoot(root, relativePath);
    await writeFile(target, content, "utf8");
    return { path: path.relative(root, target), bytes: Buffer.byteLength(content) };
  }

  async editFile(rootValue: string, relativePath: string, oldText: string, newText: string) {
    const current = await this.readFile(rootValue, relativePath);
    const count = current.content.split(oldText).length - 1;
    if (count !== 1) throw new Error(count === 0 ? "未找到要替换的文本" : "oldText 必须只匹配一次");
    await this.writeFile(rootValue, relativePath, current.content.replace(oldText, newText));
    return { path: current.path, changed: true as const };
  }

  async searchFiles(
    rootValue: string,
    options: { path?: string; pattern?: string; query?: string; maxResults?: number },
  ) {
    const root = rootPath(rootValue);
    const start = withinRoot(root, options.path || ".");
    const limit = Math.min(Math.max(options.maxResults ?? 100, 1), MAX_SEARCH_RESULTS);
    const matches: string[] = [];
    const needle = options.query?.trim().toLowerCase();
    const pattern = options.pattern?.trim();
    const matchesFile = (target: string) =>
      !pattern ||
      new RegExp(
        `^${pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
        "i",
      ).test(path.basename(target));
    async function visit(directory: string): Promise<void> {
      if (matches.length >= limit) return;
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (matches.length >= limit) return;
        const target = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!SKIPPED_DIRECTORIES.has(entry.name)) await visit(target);
          continue;
        }
        if (!entry.isFile() || !matchesFile(target)) continue;
        try {
          const metadata = await stat(target);
          if (metadata.size > MAX_FILE_BYTES) continue;
          if (needle && !(await readFile(target, "utf8")).toLowerCase().includes(needle)) continue;
          matches.push(path.relative(root, target));
        } catch {
          // Ignore unreadable files while searching.
        }
      }
    }
    await visit(start);
    return { query: needle || undefined, pattern, matches, truncated: matches.length >= limit };
  }

  inspectGit(rootValue: string) {
    const root = rootPath(rootValue);
    return inspectGit(root);
  }

  readGitDiff(rootValue: string, relativePath: string) {
    return readGitDiff(rootPath(rootValue), relativePath);
  }

  restoreGit(rootValue: string, relativePath?: string) {
    return restoreGit(rootPath(rootValue), relativePath);
  }

  commitGit(rootValue: string, message?: string, push?: boolean) {
    return commitGit(rootPath(rootValue), message, push);
  }

  pushGit(rootValue: string) {
    return pushGit(rootPath(rootValue));
  }

  runShell(
    rootValue: string,
    command: string,
    mode: SandboxMode,
    relativeCwd?: string,
    allowOutside = false,
    developerToolPaths: string[] = [],
  ) {
    const root = rootPath(rootValue);
    const cwd = resolveCommandCwd(root, relativeCwd, mode, allowOutside);
    return runSandboxedShell(command, { cwd, mode, allowOutside, developerToolPaths });
  }

  async listViteProcesses() {
    if (process.platform === "win32") throw new Error("Windows 进程管理暂未实现");
    const output = await execFileAsync("ps", ["-axo", "pid=,comm=,args="]);
    const processes: ViteProcess[] = [];
    for (const line of output.stdout.split(/\r?\n/)) {
      const fields = line.trim().split(/\s+/, 3);
      const pid = Number(fields[0]);
      const name = fields[1];
      const command = fields[2] || name;
      if (
        !pid ||
        !name ||
        (!name.toLowerCase().includes("vite") && !command.toLowerCase().includes("vite"))
      )
        continue;
      processes.push({ pid, name, command, ports: await this.listListeningPorts(pid) });
    }
    return processes.sort((a, b) => a.pid - b.pid);
  }

  async killViteProcess(pid: number) {
    if (pid <= 1 || process.platform === "win32") throw new Error("无效的进程 ID");
    const processInfo = await execFileAsync("ps", ["-p", String(pid), "-o", "comm=,args="]).catch(
      () => null,
    );
    const details = processInfo?.stdout.toLowerCase() ?? "";
    if (!details.includes("vite")) throw new Error("该进程已不存在，或不再是 Vite 进程");
    await execFileAsync("kill", ["-TERM", String(pid)]);
  }

  private async listListeningPorts(pid: number) {
    const output = await execFileAsync("lsof", [
      "-nP",
      "-a",
      "-p",
      String(pid),
      "-iTCP",
      "-sTCP:LISTEN",
    ]).catch(() => null);
    if (!output) return [];
    return [
      ...new Set(
        output.stdout.split(/\r?\n/).flatMap((line) => {
          const port = line.match(/:(\d+)\s+\(LISTEN\)/)?.[1];
          return port ? [Number(port)] : [];
        }),
      ),
    ];
  }
}

export const nodePlatform = new NodePlatformAdapter();
