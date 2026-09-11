import {
  hasRequiredMacOSPermissions,
  openMacOSScreenRecordingSettings,
  requestMacOSPermissions,
} from "@trycua/cua-driver/electron";
import { currentMacOsPermissionStatus } from "@trycua/cua-driver";
import { EmbeddedCuaDriverHost, EmbeddedDriverHostState } from "@trycua/cua-driver/embedded";
import { app, shell } from "electron";
import type {
  ComputerUsePermissionOwner,
  ComputerUsePermissionTarget,
} from "@chatdesk/shared";
import { kill } from "node:process";
import { accessSync, constants, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

export const COMPUTER_USE_SERVER_ID = "computer-use";

export type ComputerUsePermissionStatus = {
  accessibility: boolean;
  screenRecording: boolean;
};

export type ComputerUseStatus = {
  supported: boolean;
  enabled: boolean;
  driverInstalled: boolean;
  driverPath: string | null;
  hostRunning: boolean;
  permissions: ComputerUsePermissionStatus;
  permissionOwner: ComputerUsePermissionOwner;
  error: string | null;
};

export type ComputerUseMcpConfig = {
  id: typeof COMPUTER_USE_SERVER_ID;
  name: string;
  description: string;
  source: "builtin";
  transport: "stdio";
  command: string;
  args: string[];
  environment: Array<{ name: string; value: string }>;
  enabledByDefault: true;
};

const PACKAGED_BUNDLE_ID = "org.bohao.mdashboard";
/** Development runs the stock Electron bundle, not a signed ChatDesk app. */
const DEVELOPMENT_BUNDLE_ID = "com.github.Electron";
const ACCESSIBILITY_PANE =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";
const STOP_TIMEOUT_MS = 2_000;

/**
 * macOS TCC charges Accessibility and Screen Recording to the responsible
 * process, not to an executable path, and the embedded driver deliberately
 * stays inside the host's responsibility chain. The packaged ChatDesk bundle is
 * therefore the identity users must authorize; in development that identity is
 * whichever app launched Electron — the terminal for `pnpm dev`, or the stock
 * Electron bundle otherwise.
 */
export function computerUsePermissionOwner(packaged: boolean): ComputerUsePermissionOwner {
  return packaged
    ? { name: "ChatDesk", bundleId: PACKAGED_BUNDLE_ID, packaged: true }
    : { name: "开发环境宿主（Terminal / Electron）", bundleId: DEVELOPMENT_BUNDLE_ID, packaged: false };
}

function hostBundleId() {
  return app.isPackaged ? PACKAGED_BUNDLE_ID : DEVELOPMENT_BUNDLE_ID;
}

type CuaDriverCandidatesInput = {
  platform: NodeJS.Platform;
  packaged: boolean;
  appPath: string;
  resourcesPath: string;
  home: string;
  env: NodeJS.ProcessEnv;
};

/**
 * Every place a `cua-driver` executable may live, in priority order. Export the
 * list so the ordering stays testable without touching the filesystem.
 */
export function cuaDriverCandidatePaths(input: CuaDriverCandidatesInput): string[] {
  const binary = input.platform === "win32" ? "cua-driver.exe" : "cua-driver";
  return [
    input.env.CHATDESK_CUA_DRIVER,
    input.env.CUA_DRIVER_BINARY,
    join(input.resourcesPath, "cua-driver", binary),
    join(input.resourcesPath, "binaries", binary),
    // `pnpm dev` runs Electron from `apps/electron`, so the staged binary in the
    // repository lives one directory over. The packaged app uses Resources.
    input.packaged ? undefined : join(input.appPath, "..", "desktop", "assets", "binaries", binary),
    input.platform === "darwin" ? "/Applications/CuaDriver.app/Contents/MacOS/cua-driver" : undefined,
    join(input.home, ".local", "bin", binary),
  ].filter((value): value is string => Boolean(value));
}

function resolveDriverPath() {
  const candidates = cuaDriverCandidatePaths({
    platform: process.platform,
    packaged: app.isPackaged,
    appPath: app.getAppPath(),
    resourcesPath: process.resourcesPath,
    home: app.getPath("home"),
    env: process.env,
  });

  try {
    const fromPath = execFileSync("which", ["cua-driver"], { encoding: "utf8" }).trim();
    if (fromPath) candidates.push(fromPath);
  } catch {
    // The packaged binary and explicit environment variables are checked below.
  }

  return candidates.find((candidate) => {
    if (!existsSync(candidate)) return false;
    try {
      accessSync(candidate, constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }) ?? null;
}

function readPermissions(): ComputerUsePermissionStatus {
  if (process.platform !== "darwin") return { accessibility: false, screenRecording: false };
  try {
    const permissions = currentMacOsPermissionStatus();
    return {
      accessibility: permissions.accessibility,
      screenRecording: permissions.screenRecording,
    };
  } catch {
    return { accessibility: false, screenRecording: false };
  }
}

export class ComputerUseManager {
  private host: EmbeddedCuaDriverHost | null = null;
  private connection: Awaited<ReturnType<EmbeddedCuaDriverHost["start"]>> | null = null;
  private exitController: AbortController | null = null;
  private watchToken = 0;
  private enabled = false;
  private error: string | null = null;

  constructor(private readonly emitStatus?: (status: ComputerUseStatus) => void) {}

  setEnabledState(enabled: boolean) {
    this.enabled = enabled;
    this.emitStatus?.(this.status());
  }

  status(): ComputerUseStatus {
    const driverPath = resolveDriverPath();
    const permissions = readPermissions();
    return {
      supported: process.platform === "darwin",
      enabled: this.enabled,
      driverInstalled: driverPath !== null,
      driverPath,
      hostRunning: this.host?.state() === EmbeddedDriverHostState.Ready,
      permissions,
      permissionOwner: computerUsePermissionOwner(app.isPackaged),
      error: this.error,
    };
  }

  async start() {
    if (process.platform !== "darwin") throw new Error("Computer Use 目前只支持 macOS");
    const driverPath = resolveDriverPath();
    if (!driverPath) {
      throw new Error("找不到 cua-driver，请安装 Cua Driver 或配置 CHATDESK_CUA_DRIVER");
    }
    const permissions = readPermissions();
    if (!hasRequiredMacOSPermissions(permissions)) {
      throw new Error("请先授予辅助功能和屏幕与系统音频录制权限");
    }
    if (this.connection && this.host && this.host.state() === EmbeddedDriverHostState.Ready) {
      return this.connection;
    }

    const host = new EmbeddedCuaDriverHost(driverPath, hostBundleId());
    try {
      const connection = await host.start();
      this.host = host;
      this.connection = connection;
      this.error = null;
      this.watchGeneration(host, connection);
      this.emitStatus?.(this.status());
      return connection;
    } catch (error) {
      host.uniffiDestroy();
      this.error = error instanceof Error ? error.message : String(error);
      this.emitStatus?.(this.status());
      throw error;
    }
  }

  /**
   * Restart the embedded driver so it re-reads TCC. macOS caches permission
   * answers per process, so a grant made while the driver is running stays
   * invisible until the child is replaced.
   */
  async refresh(): Promise<ComputerUseStatus> {
    const host = this.host;
    const connection = this.connection;
    if (process.platform !== "darwin" || !this.enabled || !host || !connection) {
      return this.status();
    }
    this.exitController?.abort();
    this.exitController = null;
    this.watchToken += 1;
    try {
      const next = await host.restart();
      if (this.host !== host) {
        // A concurrent stop() won the race; never resurrect a disposed host.
        return this.status();
      }
      this.connection = next;
      this.error = null;
      this.watchGeneration(host, next);
    } catch (error) {
      if (this.host === host) {
        this.host = null;
        this.connection = null;
        host.uniffiDestroy();
      }
      this.error = error instanceof Error ? error.message : String(error);
    }
    this.emitStatus?.(this.status());
    return this.status();
  }

  private watchGeneration(
    host: EmbeddedCuaDriverHost,
    connection: Awaited<ReturnType<EmbeddedCuaDriverHost["start"]>>,
  ) {
    const token = (this.watchToken += 1);
    const exitController = new AbortController();
    this.exitController = exitController;
    const settle = (error: string | null) => {
      if (token !== this.watchToken) return;
      if (this.host !== host) return;
      this.host = null;
      this.connection = null;
      this.exitController = null;
      this.error = error;
      host.uniffiDestroy();
      this.emitStatus?.(this.status());
    };
    void host
      .waitForExit(connection.generation, { signal: exitController.signal })
      .then((exit) => {
        settle(exit.success ? null : `cua-driver 已退出${exit.code === undefined ? "" : `（${exit.code}）`}`);
      })
      .catch((error) => {
        if (exitController.signal.aborted) return;
        settle(error instanceof Error ? error.message : String(error));
      });
  }

  async stop() {
    const host = this.host;
    const connection = this.connection;
    this.exitController = null;
    this.host = null;
    this.connection = null;
    if (host) {
      let stopped = false;
      try {
        stopped = await Promise.race([
          host.stop().then(() => true).catch(() => true),
          delay(STOP_TIMEOUT_MS).then(() => false),
        ]);
      } finally {
        if (!stopped && connection?.pid) {
          try {
            kill(connection.pid, "SIGKILL");
          } catch {
            // The daemon may have exited during the timeout window.
          }
        }
        host.uniffiDestroy();
      }
    }
    this.emitStatus?.(this.status());
  }

  mcpConfig(): ComputerUseMcpConfig | null {
    const connection = this.connection;
    if (!connection) return null;
    return {
      id: COMPUTER_USE_SERVER_ID,
      name: "Computer Use",
      description: "查看和操作当前 macOS 桌面页面",
      source: "builtin",
      transport: "stdio",
      command: connection.mcp.command,
      args: [...connection.mcp.args],
      environment: connection.mcp.environment.map(({ name, value }) => ({ name, value })),
      enabledByDefault: true,
    };
  }

  /**
   * Ask macOS for both grants — the request itself is what registers the host
   * app in the Privacy panes — then open the pane the caller asked for. Without
   * a target, open the first pane that is still missing instead of opening both
   * at once, because System Settings navigates to whichever pane opens last.
   */
  async openPermissions(target?: ComputerUsePermissionTarget) {
    if (process.platform !== "darwin") return;
    const permissions = requestMacOSPermissions();
    if (target === "accessibility") {
      await shell.openExternal(ACCESSIBILITY_PANE);
      return;
    }
    if (target === "screenRecording") {
      await openMacOSScreenRecordingSettings();
      return;
    }
    if (!permissions.screenRecording) {
      await openMacOSScreenRecordingSettings();
      return;
    }
    if (!permissions.accessibility) {
      await shell.openExternal(ACCESSIBILITY_PANE);
      return;
    }
    await openMacOSScreenRecordingSettings();
  }

  async dispose() {
    await this.stop();
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
