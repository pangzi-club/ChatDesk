import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { SandboxMode } from "./protocol.ts";

const execFileAsync = promisify(execFile);
const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

export async function runSandboxedShell(
  command: string,
  options: { cwd: string; mode: SandboxMode; allowOutside?: boolean; timeoutMs?: number },
) {
  const cwd = resolveDirectory(options.cwd);
  const timeout = options.timeoutMs ?? 120_000;
  const shell = process.env.SHELL || "/bin/sh";
  const effectiveMode = options.allowOutside ? "full" : options.mode;
  const args =
    effectiveMode === "full"
      ? ["-lc", command]
      : ["-p", buildSeatbeltProfile(cwd), shell, "-lc", command];
  const executable = effectiveMode === "full" ? shell : "/usr/bin/sandbox-exec";

  if (effectiveMode !== "full" && process.platform !== "darwin") {
    throw new Error("受限沙箱需要 macOS Seatbelt；当前平台不支持，已拒绝执行命令");
  }

  try {
    const result = await execFileAsync(executable, args, {
      cwd,
      timeout,
      maxBuffer: MAX_OUTPUT_BYTES,
      shell: false,
    });
    return { code: 0, out: `${result.stdout}${result.stderr}`.slice(0, MAX_OUTPUT_BYTES) };
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
    };
  }
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

function buildSeatbeltProfile(workspace: string) {
  const temp = realpathSync(os.tmpdir());
  const escape = (value: string) => value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  return [
    "(version 1)",
    "(allow default)",
    `(deny file-write* (require-not (require-any (subpath "${escape(workspace)}") (subpath "${escape(temp)}") (subpath "/dev/null") (subpath "/dev/tty"))))`,
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
    throw new Error("受限模式下 Bash 只能在当前 workspace 内执行");
  }
  return resolveDirectory(resolved);
}
