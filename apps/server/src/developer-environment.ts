import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, constants, statSync } from "node:fs";
import { access, readFile, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import {
  DEVELOPMENT_TOOL_NAMES,
  type DeveloperEnvironmentStatus,
  type DevelopmentToolName,
  type DevelopmentToolStatus,
} from "@chatdesk/shared";

const execFileAsync = promisify(execFile);
const IMPORT_TIMEOUT_MS = 5_000;
const MAX_IMPORT_OUTPUT_BYTES = 128 * 1024;
const BASE_PATH = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin";
const SYSTEM_TOOL_PATHS = ["/usr/bin", "/bin", "/usr/sbin", "/sbin"];
const SUPPORTED_SHELLS = new Set(["bash", "dash", "fish", "ksh", "sh", "zsh"]);

export function isDeveloperToolDirectory(value: string) {
  if (!path.isAbsolute(value)) return false;
  const resolved = path.resolve(value);
  const disallowed = new Set([
    path.parse(resolved).root,
    os.homedir(),
    "/Applications",
    "/Library",
    "/System",
    "/Users",
    "/Volumes",
    "/etc",
    "/opt",
    "/private",
    "/usr",
    "/var",
  ]);
  if (disallowed.has(resolved)) return false;
  try {
    if (!statSync(resolved).isDirectory()) return false;
    return DEVELOPMENT_TOOL_NAMES.some((name) => {
      const executable = path.join(resolved, name);
      try {
        if (!statSync(executable).isFile()) return false;
        accessSync(executable, constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

async function isExecutableFile(value: string) {
  try {
    const metadata = await stat(value);
    if (!metadata.isFile()) return false;
    await access(value, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveAllowedShell() {
  const configured = process.env.SHELL?.trim();
  const listedShells = await readFile("/etc/shells", "utf8")
    .then(
      (value) =>
        new Set(
          value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.startsWith("/") && !line.startsWith("/#")),
        ),
    )
    .catch(() => new Set<string>());
  const candidates = [configured, "/bin/zsh", "/bin/bash", "/bin/sh"].filter(
    (value): value is string =>
      Boolean(
        value && path.isAbsolute(value) && SUPPORTED_SHELLS.has(path.basename(value).toLowerCase()),
      ),
  );
  for (const candidate of candidates) {
    if (listedShells.size > 0 && !listedShells.has(candidate)) continue;
    if (await isExecutableFile(candidate)) return realpath(candidate);
  }
  throw new Error("找不到允许用于导入开发工具的登录 Shell");
}

function safeImportEnvironment(shell: string) {
  const home = os.homedir();
  const user = os.userInfo().username;
  return {
    HOME: home,
    USER: user,
    LOGNAME: user,
    SHELL: shell,
    PATH: BASE_PATH,
    LANG: process.env.LANG || "en_US.UTF-8",
    TERM: "dumb",
  };
}

export function buildDeveloperToolImportCommand(marker: string, shell: string) {
  const names = DEVELOPMENT_TOOL_NAMES.join(" ");
  if (path.basename(shell).toLowerCase() === "fish") {
    return `for name in ${names}; set resolved (command -s "$name" 2>/dev/null); if string match -qr '^/' -- "$resolved"; printf '${marker}%s\\t%s\\n' "$name" "$resolved"; end; end`;
  }
  return `for name in ${names}; do resolved=$(command -v "$name" 2>/dev/null || true); case "$resolved" in /*) printf '${marker}%s\\t%s\\n' "$name" "$resolved" ;; esac; done`;
}

async function normalizeTool(name: DevelopmentToolName, executable: string) {
  if (!path.isAbsolute(executable) || !(await isExecutableFile(executable))) return undefined;
  const resolved = await realpath(executable).catch(() => executable);
  if (!(await isExecutableFile(resolved))) return undefined;
  return {
    name,
    available: true,
    executable: resolved,
    directory: path.dirname(executable),
  } satisfies DevelopmentToolStatus;
}

export async function importDeveloperEnvironment(): Promise<DeveloperEnvironmentStatus> {
  if (process.platform === "win32") {
    throw new Error("Windows 暂不支持从登录 Shell 导入开发工具");
  }
  const shell = await resolveAllowedShell();
  const marker = `__CHATDESK_TOOL_${randomBytes(12).toString("hex")}__`;
  const { stdout } = await execFileAsync(
    shell,
    ["-ilc", buildDeveloperToolImportCommand(marker, shell)],
    {
      cwd: os.homedir(),
      env: safeImportEnvironment(shell),
      timeout: IMPORT_TIMEOUT_MS,
      maxBuffer: MAX_IMPORT_OUTPUT_BYTES,
      windowsHide: true,
    },
  ).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`导入登录 Shell 环境失败：${message}`);
  });
  const discovered = new Map<DevelopmentToolName, DevelopmentToolStatus>();
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.startsWith(marker)) continue;
    const [rawName, executable] = line.slice(marker.length).split("\t", 2);
    if (!DEVELOPMENT_TOOL_NAMES.includes(rawName as DevelopmentToolName) || !executable) continue;
    const name = rawName as DevelopmentToolName;
    const tool = await normalizeTool(name, executable.trim());
    if (tool) discovered.set(name, tool);
  }
  const paths = [
    ...new Set(
      [...discovered.values()]
        .map((tool) => tool.directory)
        .filter(
          (value): value is string => Boolean(value) && !SYSTEM_TOOL_PATHS.includes(value ?? ""),
        ),
    ),
  ];
  return environmentStatus(shell, paths, discovered);
}

export async function inspectDeveloperEnvironment(
  configuredPaths: string[],
): Promise<DeveloperEnvironmentStatus> {
  const paths = await normalizeDeveloperToolPaths(configuredPaths);
  const searchPaths = [...new Set([...paths, ...SYSTEM_TOOL_PATHS])];
  const discovered = new Map<DevelopmentToolName, DevelopmentToolStatus>();
  for (const name of DEVELOPMENT_TOOL_NAMES) {
    for (const directory of searchPaths) {
      const tool = await normalizeTool(name, path.join(directory, name));
      if (!tool) continue;
      discovered.set(name, tool);
      break;
    }
  }
  return environmentStatus(process.env.SHELL || "/bin/sh", paths, discovered);
}

export async function normalizeDeveloperToolPaths(values: string[]) {
  const paths: string[] = [];
  for (const value of values.slice(0, 50)) {
    const candidate = value.trim();
    if (!candidate || !path.isAbsolute(candidate)) continue;
    if (!isDeveloperToolDirectory(candidate)) continue;
    const normalized = path.normalize(candidate);
    if (!paths.includes(normalized)) paths.push(normalized);
  }
  return paths;
}

function environmentStatus(
  shell: string,
  paths: string[],
  discovered: Map<DevelopmentToolName, DevelopmentToolStatus>,
): DeveloperEnvironmentStatus {
  return {
    shell,
    paths,
    tools: DEVELOPMENT_TOOL_NAMES.map((name) => discovered.get(name) ?? { name, available: false }),
  };
}
