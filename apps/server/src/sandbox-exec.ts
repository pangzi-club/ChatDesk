import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEVELOPMENT_TOOL_NAMES } from "@chatdesk/shared";

import { isDeveloperToolDirectory } from "./developer-environment.ts";
import type { SandboxMode } from "./protocol.ts";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_HELPER_OUTPUT_BYTES = 2 * 1024 * 1024;
const BASE_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const SAFE_ENV_KEYS = [
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TERM",
  "COLORTERM",
  "PATH",
  "SHELL",
  "TMPDIR",
] as const;

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
    developerToolPaths?: string[];
    allowNetwork?: boolean;
  },
) {
  const cwd = resolveDirectory(options.cwd);
  const timeout = options.timeoutMs ?? 120_000;
  const shell = process.env.SHELL || "/bin/sh";
  const effectiveMode = options.allowOutside ? "full" : options.mode;
  const args =
    effectiveMode === "full"
      ? ["-c", command]
      : [
          "-p",
          buildSeatbeltProfile(
            cwd,
            options.readablePaths ?? [],
            [],
            [],
            options.developerToolPaths ?? [],
            options.allowNetwork ?? false,
          ),
          shell,
          "-c",
          command,
        ];
  const executable = effectiveMode === "full" ? shell : "/usr/bin/sandbox-exec";

  if (effectiveMode !== "full" && process.platform !== "darwin") {
    throw new SandboxBlockedError("受限沙箱需要 macOS Seatbelt；当前平台不支持");
  }

  const result = await runBoundedProcess(executable, args, {
    cwd,
    env: sandboxEnvironment(cwd, options.developerToolPaths),
    timeout,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  });
  return {
    code: result.code,
    out: result.out,
    sandboxBlocked: effectiveMode !== "full" && isSandboxBlockedOutput(result.out),
  };
}

export type SandboxFileRequest =
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
      allowOutside?: boolean;
    };

export async function runSandboxedFile(
  request: SandboxFileRequest,
  options: {
    mode: SandboxMode;
    allowOutside?: boolean;
    timeoutMs?: number;
    readablePaths?: string[];
    writablePaths?: string[];
  },
) {
  const workspace = resolveDirectory(request.workspace);
  const timeout = options.timeoutMs ?? 120_000;
  const effectiveMode = options.allowOutside ? "full" : options.mode;
  const payload = JSON.stringify(request);
  const isPackaged = (process as NodeJS.Process & { pkg?: unknown }).pkg !== undefined;
  const helperEntry = isPackaged ? undefined : resolveSandboxFileEntry();
  const helperExecutable = isPackaged ? resolvePackagedSandboxWorker() : process.execPath;
  const nodeArgs = isPackaged
    ? []
    : ["--experimental-strip-types", ...(helperEntry ? [helperEntry] : [])];
  const helperReadPaths = helperEntry ? [path.dirname(helperEntry)] : [];
  const args =
    effectiveMode === "full"
      ? nodeArgs
      : [
          "-p",
          buildSeatbeltProfile(
            workspace,
            "readablePaths" in request
              ? (request.readablePaths ?? [])
              : (options.readablePaths ?? []),
            helperReadPaths,
            options.writablePaths ?? [],
          ),
          helperExecutable,
          ...nodeArgs,
        ];
  const executable = effectiveMode === "full" ? helperExecutable : "/usr/bin/sandbox-exec";

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
      env: sandboxEnvironment(workspace),
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => killProcessTree(child), timeout);
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
          (response?.result === undefined ? stderr || "文件 helper 执行失败" : undefined),
        sandboxBlocked:
          response?.blocked === true ||
          (effectiveMode !== "full" && isSandboxBlockedOutput(`${stdout}\n${stderr}`)),
      });
    });
    child.stdin.end(payload);
  });
}

function resolveSandboxFileEntry() {
  const currentEntry = process.argv[1];
  if (currentEntry && /(?:^|[\\/])sandbox-file-entry\.(?:ts|js)$/.test(currentEntry)) {
    return currentEntry;
  }
  const candidates = [
    path.resolve(process.cwd(), "apps/server/src/sandbox-file-entry.ts"),
    path.resolve(process.cwd(), "src/sandbox-file-entry.ts"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function resolvePackagedSandboxWorker() {
  const executableDirectory = path.dirname(process.execPath);
  const candidates = [
    path.join(executableDirectory, "chat-server-sandbox"),
    path.join(executableDirectory, "chat-server-sandbox.exe"),
    path.join(executableDirectory, "binaries", "chat-server-sandbox"),
    path.join(executableDirectory, "binaries", "chat-server-sandbox.exe"),
    path.resolve(executableDirectory, "..", "resources", "chat-server-sandbox"),
    path.resolve(executableDirectory, "..", "resources", "chat-server-sandbox.exe"),
    path.resolve(executableDirectory, "..", "resources", "binaries", "chat-server-sandbox"),
    path.resolve(executableDirectory, "..", "resources", "binaries", "chat-server-sandbox.exe"),
  ];
  const worker = candidates.find((candidate) => existsSync(candidate));
  if (!worker) {
    throw new SandboxBlockedError("找不到打包的 sandbox worker");
  }
  return worker;
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

function effectivePath(developerToolPaths: string[] = []) {
  return [...developerToolPaths, ...BASE_PATH.split(path.delimiter)]
    .map((value) => value.trim())
    .filter(
      (value, index, values) =>
        (BASE_PATH.split(path.delimiter).includes(value) || isDeveloperToolDirectory(value)) &&
        values.indexOf(value) === index,
    )
    .join(path.delimiter);
}

function sandboxEnvironment(cwd: string, developerToolPaths: string[] = []) {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_ENV_KEYS) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  env.PATH = effectivePath(developerToolPaths);
  env.TMPDIR ||= os.tmpdir();
  env.SHELL ||= "/bin/sh";
  const cacheRoot = path.join(
    env.TMPDIR,
    `chatdesk-sandbox-cache-${process.pid}`,
    createHash("sha256").update(cwd).digest("hex").slice(0, 16),
  );
  env.HOME = path.join(cacheRoot, "home");
  env.XDG_CACHE_HOME = path.join(cacheRoot, "xdg-cache");
  env.XDG_DATA_HOME = path.join(cacheRoot, "xdg-data");
  env.COREPACK_HOME = path.join(cacheRoot, "corepack");
  env.npm_config_cache = path.join(cacheRoot, "npm");
  env.npm_config_store_dir = path.join(cacheRoot, "pnpm-store");
  env.PIP_CACHE_DIR = path.join(cacheRoot, "pip");
  env.UV_CACHE_DIR = path.join(cacheRoot, "uv");
  env.PYTHONPYCACHEPREFIX = path.join(cacheRoot, "python-bytecode");
  env.GOCACHE = path.join(cacheRoot, "go-build");
  env.GOMODCACHE = path.join(cacheRoot, "go-mod");
  env.GOPATH = path.join(cacheRoot, "go-path");
  env.GOTELEMETRY = "off";
  return env;
}

async function runBoundedProcess(
  executable: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv; timeout: number; maxOutputBytes: number },
) {
  return new Promise<{ code: number; out: string; timedOut: boolean }>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    let outputLimitHit = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, options.timeout);
    const append = (target: "stdout" | "stderr", chunk: Buffer) => {
      const current = target === "stdout" ? stdout : stderr;
      const remaining = Math.max(options.maxOutputBytes - Buffer.byteLength(current), 0);
      const text = chunk.subarray(0, remaining).toString();
      if (target === "stdout") stdout += text;
      else stderr += text;
      if (chunk.byteLength > remaining) {
        outputLimitHit = true;
        killProcessTree(child);
      }
    };
    child.stdout.on("data", (chunk: Buffer) => append("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => append("stderr", chunk));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      let out = `${stdout}${stderr}`;
      if (Buffer.byteLength(out) > options.maxOutputBytes) {
        out = Buffer.from(out).subarray(0, options.maxOutputBytes).toString();
      }
      if (timedOut) out = `${out}${out ? "\n" : ""}命令执行超时，进程已终止`;
      if (outputLimitHit) out = `${out}${out ? "\n" : ""}命令输出超过限制，进程已终止`;
      resolve({ code: code ?? -1, out: out || "命令执行失败", timedOut });
    });
  });
}

function killProcessTree(child: ReturnType<typeof spawn>) {
  if (child.pid && process.platform === "win32") {
    spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Fall back to killing the direct child when the process group is gone.
    }
  }
  child.kill("SIGKILL");
}

export function buildSeatbeltProfile(
  workspace: string,
  readablePaths: string[] = [],
  additionalReadPaths: string[] = [],
  additionalWritePaths: string[] = [],
  developerToolPaths: string[] = [],
  allowNetwork = false,
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
  const pathRoots = effectivePath(developerToolPaths)
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
    ...resolveDeveloperToolReadRoots(developerToolPaths),
    ...configuredReadRoots,
    ...additionalReadPaths,
  ].filter((value, index, values) => values.indexOf(value) === index);
  const writeTargets = additionalWritePaths
    .map((value) => value.trim())
    .filter((value, index, values) => value.startsWith("/") && values.indexOf(value) === index);
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
    ...writeTargets.map((value) => `(allow file-write* (literal "${escapeValue(value)}"))`),
    '(allow file-write* (literal "/dev/null"))',
    '(allow file-write* (literal "/dev/tty"))',
    allowNetwork ? "(allow network*)" : "(deny network*)",
  ].join(" ");
}

function resolveDeveloperToolReadRoots(directories: string[]) {
  const roots: string[] = [];
  const add = (value: string) => {
    if (path.isAbsolute(value) && !roots.includes(value)) roots.push(value);
  };
  for (const directory of directories) {
    const candidate = directory.trim();
    if (!isDeveloperToolDirectory(candidate)) continue;
    add(candidate);
    try {
      add(realpathSync(candidate));
    } catch {
      continue;
    }
    for (const name of DEVELOPMENT_TOOL_NAMES) {
      const executable = path.join(candidate, name);
      if (!existsSync(executable)) continue;
      try {
        const resolved = realpathSync(executable);
        const executableDirectory = path.dirname(resolved);
        add(executableDirectory);
        if (["bin", "sbin"].includes(path.basename(executableDirectory))) {
          add(path.dirname(executableDirectory));
        }
      } catch {
        // Ignore broken links; they cannot be executed and must not broaden the read policy.
      }
    }
  }
  return roots;
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
  const canonical = resolveDirectory(resolved);
  if (mode === "full" || allowOutside) return canonical;
  if (canonical !== root && !canonical.startsWith(`${root}${path.sep}`)) {
    throw new SandboxPathError("Bash cwd 必须是 workspace 内的相对路径或 workspace 内的绝对路径");
  }
  return canonical;
}
