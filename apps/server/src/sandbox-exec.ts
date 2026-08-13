import { execFile, spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { SandboxMode } from "./protocol.ts";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_HELPER_OUTPUT_BYTES = 2 * 1024 * 1024;

export class SandboxBlockedError extends Error {
  readonly code = "sandbox_blocked" as const;

  constructor(message = "被沙箱拦截了") {
    super(message);
    this.name = "SandboxBlockedError";
  }
}

export class SandboxPathError extends Error {
  readonly code = "sandbox_path_invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "SandboxPathError";
  }
}

export function isSandboxBlockedOutput(output: string) {
  if (/sandbox_apply:\s*operation not permitted/i.test(output)) return false;
  return /(?:sandbox(?:-exec)?[^\n]*(?:deny|violation)|operation not permitted|sandbox violation)/i.test(
    output,
  );
}

export async function runSandboxedShell(
  command: string,
  options: {
    cwd: string;
    mode: SandboxMode;
    allowOutside?: boolean;
    timeoutMs?: number;
    readablePaths?: string[];
  },
) {
  const cwd = resolveDirectory(options.cwd);
  const timeout = options.timeoutMs ?? 120_000;
  const shell = process.env.SHELL || "/bin/sh";
  const effectiveMode = options.allowOutside ? "full" : options.mode;
  const args =
    effectiveMode === "full"
      ? ["-lc", command]
      : ["-p", buildSeatbeltProfile(cwd, options.readablePaths ?? []), shell, "-lc", command];
  const executable = effectiveMode === "full" ? shell : "/usr/bin/sandbox-exec";

  if (effectiveMode !== "full" && process.platform !== "darwin") {
    throw new SandboxBlockedError("受限沙箱需要 macOS Seatbelt；当前平台不支持");
  }

  try {
    const result = await execFileAsync(executable, args, {
      cwd,
      env: sandboxEnvironment(cwd),
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
    });
    return {
      code: 0,
      out: `${result.stdout}${result.stderr}`.slice(0, MAX_OUTPUT_BYTES),
      sandboxBlocked: false,
    };
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    const output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`.slice(0, MAX_OUTPUT_BYTES);
    return {
      code: typeof failure.code === "number" ? failure.code : -1,
      out: output || failure.message || "命令执行失败",
      sandboxBlocked: effectiveMode !== "full" && isSandboxBlockedOutput(output),
    };
  }
}

export type SandboxReadRequest =
  | { operation: "list_dir"; workspace: string; path?: string; readablePaths?: string[] }
  | { operation: "read_file"; workspace: string; path: string; readablePaths?: string[] }
  | {
      operation: "search_files";
      workspace: string;
      path?: string;
      pattern?: string;
      query?: string;
      maxResults?: number;
      readablePaths?: string[];
    };

export async function runSandboxedRead(
  request: SandboxReadRequest,
  options: { mode: SandboxMode; allowOutside?: boolean; timeoutMs?: number },
) {
  const workspace = resolveDirectory(request.workspace);
  const timeout = options.timeoutMs ?? 120_000;
  const effectiveMode = options.allowOutside ? "full" : options.mode;
  const payload = JSON.stringify(request);
  const isPackaged = (process as NodeJS.Process & { pkg?: unknown }).pkg !== undefined;
  const serverEntry = isPackaged ? undefined : resolveServerEntry();
  const nodeArgs = isPackaged
    ? []
    : ["--experimental-strip-types", ...(serverEntry ? [serverEntry] : [])];
  const args =
    effectiveMode === "full"
      ? nodeArgs
      : [
          "-p",
          buildSeatbeltProfile(workspace, request.readablePaths ?? []),
          process.execPath,
          ...nodeArgs,
        ];
  const executable = effectiveMode === "full" ? process.execPath : "/usr/bin/sandbox-exec";

  if (effectiveMode !== "full" && process.platform !== "darwin") {
    throw new SandboxBlockedError("受限沙箱需要 macOS Seatbelt；当前平台不支持");
  }

  return new Promise<{
    code: number;
    result?: unknown;
    error?: string;
    sandboxBlocked: boolean;
  }>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: workspace,
      env: {
        ...sandboxEnvironment(workspace),
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        TMPDIR: process.env.TMPDIR ?? os.tmpdir(),
        CHATDESK_SANDBOX_READ: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString()}`.slice(0, MAX_HELPER_OUTPUT_BYTES);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(0, MAX_HELPER_OUTPUT_BYTES);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      let response:
        | { ok?: boolean; result?: unknown; error?: string; blocked?: boolean }
        | undefined;
      try {
        response = JSON.parse(stdout) as typeof response;
      } catch {
        response = undefined;
      }
      resolve({
        code: code ?? -1,
        result: response?.result,
        error:
          response?.error ||
          (response?.result === undefined ? stderr || "只读 helper 执行失败" : undefined),
        sandboxBlocked:
          response?.blocked === true ||
          (effectiveMode !== "full" && isSandboxBlockedOutput(`${stdout}\n${stderr}`)),
      });
    });
    child.stdin.end(payload);
  });
}

function resolveServerEntry() {
  const currentEntry = process.argv[1];
  if (currentEntry && /(?:^|[\\/])server\.(?:ts|js)$/.test(currentEntry)) {
    return currentEntry;
  }
  const candidates = [
    path.resolve(process.cwd(), "apps/server/src/server.ts"),
    path.resolve(process.cwd(), "src/server.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function resolveDirectory(value: string) {
  const directory = value.trim();
  if (!directory) throw new Error("请选择 Bash 工作目录");
  try {
    return realpathSync(directory);
  } catch {
    throw new Error(`Bash 工作目录不存在：${directory}`);
  }
}

function sandboxEnvironment(cwd: string) {
  return {
    ...process.env,
    HOME: cwd,
  };
}

export function buildSeatbeltProfile(
  workspace: string,
  readablePaths: string[] = [],
  additionalReadPaths: string[] = [],
) {
  const temp = realpathSync(os.tmpdir());
  const escapeValue = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const configuredReadRoots = readablePaths
    .flatMap((value) => {
      const absolute = path.resolve(value.trim());
      if (!value.trim() || !path.isAbsolute(absolute)) return [];
      const roots = [absolute];
      try {
        const resolved = realpathSync(absolute);
        if (resolved !== absolute) roots.push(resolved);
      } catch {
        // Keep non-existent configured paths so they become valid if created later.
      }
      return roots;
    })
    .filter((value, index, values) => values.indexOf(value) === index);
  const pathRoots = (process.env.PATH ?? "")
    .split(path.delimiter)
    .map((value) => value.trim())
    .filter((value) => value.startsWith("/"));
  const readRoots = [
    workspace,
    temp,
    "/dev",
    "/usr",
    "/System",
    "/Library",
    "/private/etc",
    path.dirname(process.execPath),
    ...pathRoots,
    ...configuredReadRoots,
    ...additionalReadPaths,
  ].filter((value, index, values) => values.indexOf(value) === index);
  return [
    "(version 1)",
    "(deny default)",
    "(allow process-fork)",
    "(allow process-exec)",
    "(allow signal (target self))",
    "(allow sysctl-read)",
    "(allow file-ioctl)",
    "(allow user-preference-read)",
    "(allow mach-lookup)",
    "(allow mach-task-name)",
    "(allow ipc-posix*)",
    "(allow system-socket)",
    "(allow file-read-metadata)",
    '(allow file-read* (literal "/"))',
    ...readRoots.map((value) => `(allow file-read* (subpath "${escapeValue(value)}"))`),
    `(allow file-write* (subpath "${escapeValue(workspace)}"))`,
    `(allow file-write* (subpath "${escapeValue(temp)}"))`,
    '(allow file-write* (literal "/dev/null"))',
    '(allow file-write* (literal "/dev/tty"))',
    "(deny network*)",
  ].join(" ");
}

export function resolveCommandCwd(
  workspace: string,
  requested: string | undefined,
  mode: SandboxMode,
  allowOutside = false,
) {
  const root = resolveDirectory(workspace);
  const candidate = requested?.trim();
  if (!candidate) return root;
  const resolved = path.resolve(root, candidate);
  if (mode === "full" || allowOutside) return resolveDirectory(resolved);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new SandboxPathError("Bash cwd 必须是 workspace 内的相对路径或 workspace 内的绝对路径");
  }
  return resolveDirectory(resolved);
}
