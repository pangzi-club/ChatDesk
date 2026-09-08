import {
  hasRequiredMacOSPermissions,
  openMacOSScreenRecordingSettings,
  requestMacOSPermissions,
} from "@trycua/cua-driver/electron";
import { currentMacOsPermissionStatus } from "@trycua/cua-driver";
import { EmbeddedCuaDriverHost, EmbeddedDriverHostState } from "@trycua/cua-driver/embedded";
import { app, shell } from "electron";
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

const MACOS_HOST_BUNDLE_ID = "org.bohao.mdashboard";
const STOP_TIMEOUT_MS = 2_000;

function resolveDriverPath() {
  const candidates = [
    process.env.CHATDESK_CUA_DRIVER,
    process.env.CUA_DRIVER_BINARY,
    process.platform === "darwin"
      ? join(process.resourcesPath, "cua-driver", "cua-driver")
      : join(process.resourcesPath, "cua-driver", "cua-driver.exe"),
    join(process.resourcesPath, "binaries/cua-driver"),
    join(app.getAppPath(), "apps/electron/assets/binaries/cua-driver"),
    join(app.getAppPath(), "apps/electron/assets/binaries/cua-driver.exe"),
    "/Applications/CuaDriver.app/Contents/MacOS/cua-driver",
    join(app.getPath("home"), ".local/bin/cua-driver"),
  ].filter((value): value is string => Boolean(value));

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

    const host = new EmbeddedCuaDriverHost(driverPath, MACOS_HOST_BUNDLE_ID);
    try {
      const connection = await host.start();
      this.host = host;
      this.connection = connection;
      this.error = null;
      const exitController = new AbortController();
      this.exitController = exitController;
      this.emitStatus?.(this.status());
      void host.waitForExit(connection.generation, { signal: exitController.signal }).then((exit) => {
        if (this.host !== host || this.connection?.generation !== connection.generation) return;
        this.host = null;
        this.connection = null;
        this.error = exit.success ? null : `cua-driver 已退出${exit.code === undefined ? "" : `（${exit.code}）`}`;
        host.uniffiDestroy();
        this.emitStatus?.(this.status());
      }).catch((error) => {
        if (exitController.signal.aborted) return;
        if (this.host !== host || this.connection?.generation !== connection.generation) return;
        this.host = null;
        this.connection = null;
        this.error = error instanceof Error ? error.message : String(error);
        host.uniffiDestroy();
        this.emitStatus?.(this.status());
      });
      return connection;
    } catch (error) {
      host.uniffiDestroy();
      this.error = error instanceof Error ? error.message : String(error);
      this.emitStatus?.(this.status());
      throw error;
    }
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

  async openPermissions() {
    if (process.platform !== "darwin") return;
    const permissions = requestMacOSPermissions();
    if (!permissions.screenRecording) {
      await openMacOSScreenRecordingSettings();
    } else if (!permissions.accessibility) {
      await shell.openExternal(
        "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
      );
    }
  }

  async dispose() {
    await this.stop();
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
