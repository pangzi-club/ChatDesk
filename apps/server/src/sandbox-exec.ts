import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEVELOPMENT_TOOL_NAMES } from "@chatdesk/shared";

import { isDeveloperToolDirectory } from "./developer-environment.ts";
import type { SandboxMode } from "./protocol.ts";

const MAX_OUTPUT_BYTES = 128 * 1024;
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

export type SandboxDenialKind = "network" | "filesystem";

export class SandboxBlockedError extends Error {
  readonly code = "sandbox_blocked" as const;
  readonly denialKind?: SandboxDenialKind;

  constructor(message = "被沙箱拦截了", denialKind?: SandboxDenialKind) {
    super(message);
    this.name = "SandboxBlockedError";
    this.denialKind = denialKind;
  }
}

export class SandboxPathError extends Error {
  readonly code = "sandbox_path_invalid" as const;

  constructor(message: string) {
    super(message);
    this.name = "SandboxPathError";
  }
}

const FILE_SANDBOX_DENIED_PATTERN =
  /(?:sandbox(?:-exec)?[^\n]*(?:deny|violation)|file system sandbox blocked|sandbox violation)/i;
const NETWORK_SANDBOX_DENIED_PATTERN =
  /nodename nor servname provided|failed to resolve address|could not resolve host|couldn['’]t resolve host|could not resolve hostname|被沙箱拦截了网络访问|ERR_PNPM_META_FETCH_FAIL|ERR_PNPM_FETCH|\bfetch failed\b|error when performing the request to https?:\/\/|\b(?:GET|request to)\s+https?:\/\/[^\s]*(?:npmjs\.org|registry\.)[^\n]*(?:fetch failed|failed)|\b(?:EAI_AGAIN|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b/i;

export type SandboxDenialOptions = {
  allowNetwork?: boolean;
  command?: string;
  code?: number;
  timedOut?: boolean;
};

export function isFilesystemSandboxDenial(output: string) {
  return /file system sandbox blocked/i.test(output);
}

export function isNetworkSandboxDenial(output: string) {
  return NETWORK_SANDBOX_DENIED_PATTERN.test(output);
}

export function silentNetworkDenialReason(command: string, code: number) {
  if (/\bcurl\b/i.test(command) && (code === 6 || code === 7)) {
    return `被沙箱拦截了网络访问（curl 退出码 ${code}）`;
  }
  if (/\bwget\b/i.test(command) && code === 4) {
    return `被沙箱拦截了网络访问（wget 退出码 ${code}）`;
  }
  return undefined;
}

export function classifySandboxDenial(
  output: string,
  options: SandboxDenialOptions = {},
): SandboxDenialKind | null {
  if (/sandbox_apply:\s*operation not permitted/i.test(output)) return null;
  if (FILE_SANDBOX_DENIED_PATTERN.test(output)) return "filesystem";
  if (!options.allowNetwork) {
    if (isNetworkSandboxDenial(output)) return "network";
    if (
      !options.timedOut &&
      typeof options.command === "string" &&
      typeof options.code === "number" &&
      silentNetworkDenialReason(options.command, options.code)
    ) {
      return "network";
    }
  }
  if (/operation not permitted/i.test(output)) return "filesystem";
  return null;
}

export function isSandboxBlockedOutput(output: string, options: SandboxDenialOptions = {}) {
  return classifySandboxDenial(output, options) !== null;
}

export function sandboxBlockedErrorFromShell(
  command: string,
  result: {
    out: string;
    code: number;
    timedOut?: boolean;
    sandboxDenialKind?: SandboxDenialKind | null;
  },
) {
  const kind =
    result.sandboxDenialKind ??
    classifySandboxDenial(result.out, {
      command,
      code: result.code,
      timedOut: result.timedOut,
    }) ??
    undefined;
  const output = result.out.trim();
  const silentReason =
    kind === "network" ? silentNetworkDenialReason(command, result.code) : undefined;
  const message =
    silentReason && !isNetworkSandboxDenial(output)
      ? output
        ? `${output}\n${silentReason}`
        : silentReason
      : output || "被沙箱拦截了";
  return new SandboxBlockedError(message, kind);
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
    abortSignal?: AbortSignal;
  },
) {
  const cwd = resolveDirectory(options.cwd);
  const timeout = options.timeoutMs ?? 120_000;
  const shell = resolveExecutionShell();
  const shellArgs = buildShellArgs(shell, command);
  const effectiveMode = options.allowOutside ? "full" : options.mode;
  const args =
    effectiveMode === "full"
      ? shellArgs
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
          ...shellArgs,
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
    abortSignal: options.abortSignal,
  });
  const allowNetwork = options.allowNetwork ?? false;
  const sandboxDenialKind =
    effectiveMode === "full"
      ? null
      : classifySandboxDenial(result.out, {
          allowNetwork,
          command,
          code: result.code,
          timedOut: result.timedOut,
        });
  return {
    code: result.code,
    out: result.out,
    success: result.code === 0 && !result.timedOut,
    timedOut: result.timedOut,
    truncated: result.truncated,
    totalOutputBytes: result.totalOutputBytes,
    sandboxBlocked: sandboxDenialKind !== null,
    sandboxDenialKind: sandboxDenialKind ?? undefined,
  };
}

export function spawnSandboxedShell(
  command: string,
  options: {
    cwd: string;
    mode: SandboxMode;
    allowOutside?: boolean;
    readablePaths?: string[];
    developerToolPaths?: string[];
    allowNetwork?: boolean;
  },
) {
  const cwd = resolveDirectory(options.cwd);
  const shell = resolveExecutionShell();
  const shellArgs = buildShellArgs(shell, command);
  const effectiveMode = options.allowOutside ? "full" : options.mode;
  const args =
    effectiveMode === "full"
      ? shellArgs
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
          ...shellArgs,
        ];
  if (effectiveMode !== "full" && process.platform !== "darwin") {
    throw new SandboxBlockedError("受限沙箱需要 macOS Seatbelt；当前平台不支持");
  }
  const executable = effectiveMode === "full" ? shell : "/usr/bin/sandbox-exec";
  return spawn(executable, args, {
    cwd,
    env: sandboxEnvironment(cwd, options.developerToolPaths),
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });
}

function resolveExecutionShell() {
  if (process.platform === "darwin" && existsSync("/bin/zsh")) return "/bin/zsh";
  return process.env.SHELL || "/bin/sh";
}

function buildShellArgs(shell: string, command: string) {
  const name = path.basename(shell).toLowerCase();
  return ["bash", "zsh", "ksh"].includes(name)
    ? ["-o", "pipefail", "-c", command]
    : ["-c", command];
}

export type SandboxFileRequest =
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
      readablePaths?: string[];
    }
  | {
      operation: "search_files";
      workspace: string;
      path?: string;
      pattern?: string;
      query?: string;
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
      allowOutside?: boolean;
    }
  | { operation: "apply_patch"; workspace: string; patch: string };

type SandboxFileResponse = {
  ok?: boolean;
  result?: unknown;
  error?: string;
  blocked?: boolean;
};

export function resolveSandboxFileProcessOutput(
  stdout: string,
  stderr: string,
  code: number,
  sandboxed: boolean,
) {
  let response: SandboxFileResponse | undefined;
  try {
    const parsed = JSON.parse(stdout) as unknown;
    if (parsed && typeof parsed === "object") response = parsed as SandboxFileResponse;
  } catch {
    response = undefined;
  }
  return {
    code,
    result: response?.result,
    error:
      response?.error ||
      (response?.result === undefined ? stderr || "文件 helper 执行失败" : undefined),
    sandboxBlocked:
      response?.blocked === true ||
      (response === undefined && sandboxed && isSandboxBlockedOutput(stderr)),
  };
}

export function resolveSandboxWorkerCommand(
  env: NodeJS.ProcessEnv = process.env,
  nodeExecutable = process.execPath,
  exists: (file: string) => boolean = existsSync,
  developmentEntry = resolveSandboxFileEntry(),
) {
  const configured = env.CHAT_SERVER_SANDBOX_WORKER?.trim();
  if (configured) {
    if (!exists(configured)) {
      throw new SandboxBlockedError(`找不到打包的 sandbox worker：${configured}`);
    }
    return {
      helperExecutable: nodeExecutable,
      nodeArgs: [configured],
      helperReadPaths: [path.dirname(configured)],
    };
  }
  if (env.CHAT_SERVER_PRODUCTION === "1") {
    throw new SandboxBlockedError("未配置打包的 sandbox worker");
  }
  return {
    helperExecutable: nodeExecutable,
    nodeArgs: ["--experimental-strip-types", ...(developmentEntry ? [developmentEntry] : [])],
    helperReadPaths: developmentEntry ? [path.dirname(developmentEntry)] : [],
  };
}

export async function runSandboxedFile(
  request: SandboxFileRequest,
  options: {
    mode: SandboxMode;
    allowOutside?: boolean;
    timeoutMs?: number;
    readablePaths?: string[];
    writablePaths?: string[];
    abortSignal?: AbortSignal;
  },
) {
  const workspace = resolveDirectory(request.workspace);
  const timeout = options.timeoutMs ?? 120_000;
  const effectiveMode = options.allowOutside ? "full" : options.mode;
  const payload = JSON.stringify(request);
  const { helperExecutable, nodeArgs, helperReadPaths } = resolveSandboxWorkerCommand();
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
            "developerToolPaths" in request ? (request.developerToolPaths ?? []) : [],
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
      env: sandboxEnvironment(
        workspace,
        "developerToolPaths" in request ? (request.developerToolPaths ?? []) : [],
      ),
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => killProcessTree(child), timeout);
    const abort = () => killProcessTree(child);
    if (options.abortSignal?.aborted) abort();
    options.abortSignal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = `${stdout}${chunk.toString()}`.slice(0, MAX_HELPER_OUTPUT_BYTES);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString()}`.slice(0, MAX_HELPER_OUTPUT_BYTES);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(timer);
      options.abortSignal?.removeEventListener("abort", abort);
      resolve(
        resolveSandboxFileProcessOutput(stdout, stderr, code ?? -1, effectiveMode !== "full"),
      );
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
  env.SHELL ||= "/bin/sh";
  const cacheRoot = path.join(
    os.tmpdir(),
    "chatdesk-sandbox-cache",
    createHash("sha256").update(cwd).digest("hex").slice(0, 16),
  );
  const tempRoot = path.join(cacheRoot, "tmp");
  for (const directory of [
    cacheRoot,
    tempRoot,
    path.join(cacheRoot, "xdg-cache"),
    path.join(cacheRoot, "xdg-data"),
    path.join(cacheRoot, "corepack"),
    path.join(cacheRoot, "npm"),
    path.join(cacheRoot, "pnpm-store"),
    path.join(cacheRoot, "pip"),
    path.join(cacheRoot, "uv"),
    path.join(cacheRoot, "python-bytecode"),
    path.join(cacheRoot, "go-build"),
    path.join(cacheRoot, "go-mod"),
    path.join(cacheRoot, "go-path"),
  ]) {
    mkdirSync(directory, { recursive: true });
  }
  env.TMPDIR = tempRoot;
  env.HOME = os.homedir();
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
  options: {
    cwd: string;
    env: NodeJS.ProcessEnv;
    timeout: number;
    maxOutputBytes: number;
    abortSignal?: AbortSignal;
  },
) {
  return new Promise<{
    code: number;
    out: string;
    timedOut: boolean;
    truncated: boolean;
    totalOutputBytes: number;
  }>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const headLimit = Math.floor(options.maxOutputBytes / 2);
    const tailLimit = options.maxOutputBytes - headLimit;
    let head = Buffer.alloc(0);
    let tail = Buffer.alloc(0);
    let totalOutputBytes = 0;
    let outputLimitHit = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, options.timeout);
    const abort = () => killProcessTree(child);
    if (options.abortSignal?.aborted) abort();
    options.abortSignal?.addEventListener("abort", abort, { once: true });
    const append = (chunk: Buffer) => {
      totalOutputBytes += chunk.byteLength;
      let remaining = chunk;
      if (head.byteLength < headLimit) {
        const headBytes = Math.min(headLimit - head.byteLength, remaining.byteLength);
        head = Buffer.concat([head, remaining.subarray(0, headBytes)]);
        remaining = remaining.subarray(headBytes);
      }
      if (remaining.byteLength > 0) {
        tail = Buffer.concat([tail, remaining]);
        if (tail.byteLength > tailLimit) tail = tail.subarray(tail.byteLength - tailLimit);
      }
      outputLimitHit = totalOutputBytes > options.maxOutputBytes;
    };
    child.stdout.on("data", append);
    child.stderr.on("data", append);
    child.once("error", (error) => {
      clearTimeout(timer);
      options.abortSignal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      options.abortSignal?.removeEventListener("abort", abort);
      const marker = Buffer.from(
        `\n[命令输出已截断：共 ${totalOutputBytes} 字节，仅保留开头和结尾]\n`,
      );
      const retainedBytes = Math.max(0, options.maxOutputBytes - marker.byteLength);
      const retainedHeadBytes = Math.floor(retainedBytes / 2);
      const retainedTailBytes = retainedBytes - retainedHeadBytes;
      let out = outputLimitHit
        ? Buffer.concat([
            head.subarray(0, retainedHeadBytes),
            marker,
            tail.subarray(Math.max(0, tail.byteLength - retainedTailBytes)),
          ]).toString()
        : Buffer.concat([head, tail]).toString();
      if (timedOut) {
        const suffix = `${out ? "\n" : ""}命令执行超时，进程已终止`;
        out = `${truncateUtf8(out, options.maxOutputBytes - Buffer.byteLength(suffix))}${suffix}`;
      }
      out = truncateUtf8(out, options.maxOutputBytes);
      resolve({
        code: code ?? -1,
        out,
        timedOut,
        truncated: outputLimitHit,
        totalOutputBytes,
      });
    });
  });
}

function truncateUtf8(value: string, maxBytes: number) {
  if (maxBytes <= 0) return "";
  let bytes = 0;
  let end = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > maxBytes) break;
    bytes += characterBytes;
    end += character.length;
  }
  return value.slice(0, end);
}

export function killProcessTree(child: ReturnType<typeof spawn>) {
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
