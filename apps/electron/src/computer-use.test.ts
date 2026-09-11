import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACCESSIBILITY_PANE =
  "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility";

const mocks = vi.hoisted(() => ({
  currentPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  openScreenRecordingSettings: vi.fn(),
  openExternal: vi.fn(),
  hostStart: vi.fn(),
  hostRestart: vi.fn(),
  hostState: vi.fn(),
  hostStop: vi.fn(),
  hostWaitForExit: vi.fn(),
  hostDestroy: vi.fn(),
}));

vi.mock("@trycua/cua-driver", () => ({
  currentMacOsPermissionStatus: mocks.currentPermissions,
}));

vi.mock("@trycua/cua-driver/electron", () => ({
  hasRequiredMacOSPermissions: (status: { accessibility: boolean; screenRecording: boolean }) =>
    status.accessibility && status.screenRecording,
  openMacOSScreenRecordingSettings: mocks.openScreenRecordingSettings,
  requestMacOSPermissions: mocks.requestPermissions,
}));

vi.mock("@trycua/cua-driver/embedded", () => ({
  EmbeddedCuaDriverHost: class EmbeddedCuaDriverHost {
    start = mocks.hostStart;
    restart = mocks.hostRestart;
    state = mocks.hostState;
    stop = mocks.hostStop;
    waitForExit = mocks.hostWaitForExit;
    uniffiDestroy = mocks.hostDestroy;
  },
  EmbeddedDriverHostState: { Ready: 2 },
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/app",
    getPath: () => "/home/test",
    isPackaged: false,
  },
  shell: { openExternal: mocks.openExternal },
}));

import { ComputerUseManager, cuaDriverCandidatePaths } from "./computer-use.js";

function fakeConnection(generation: string) {
  return {
    generation,
    pid: 4242,
    socketPath: `/tmp/${generation}.sock`,
    mcp: { command: "cua-driver", args: ["mcp"], environment: [] },
  };
}

describe("ComputerUseManager permissions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.stubEnv("CHATDESK_CUA_DRIVER", process.execPath);
    Object.defineProperty(process, "resourcesPath", {
      configurable: true,
      value: "/resources",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("reads permission status without requesting access", () => {
    mocks.currentPermissions.mockReturnValue({ accessibility: false, screenRecording: true });

    const status = new ComputerUseManager().status();

    expect(status.permissions).toEqual({ accessibility: false, screenRecording: true });
    expect(mocks.requestPermissions).not.toHaveBeenCalled();
  });

  it("reports the host app as the macOS permission owner", () => {
    mocks.currentPermissions.mockReturnValue({ accessibility: true, screenRecording: true });

    const status = new ComputerUseManager().status();

    expect(status.permissionOwner).toEqual({
      name: "开发环境宿主（Terminal / Electron）",
      bundleId: "com.github.Electron",
      packaged: false,
    });
  });

  it("requests access and opens Screen Recording when it is missing", async () => {
    mocks.requestPermissions.mockReturnValue({ accessibility: false, screenRecording: false });

    await new ComputerUseManager().openPermissions();

    expect(mocks.requestPermissions).toHaveBeenCalledOnce();
    expect(mocks.openScreenRecordingSettings).toHaveBeenCalledOnce();
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });

  it("opens Accessibility when Screen Recording is already granted", async () => {
    mocks.requestPermissions.mockReturnValue({ accessibility: false, screenRecording: true });

    await new ComputerUseManager().openPermissions();

    expect(mocks.openScreenRecordingSettings).not.toHaveBeenCalled();
    expect(mocks.openExternal).toHaveBeenCalledWith(ACCESSIBILITY_PANE);
  });

  it("opens exactly the pane the caller asked for", async () => {
    mocks.requestPermissions.mockReturnValue({ accessibility: false, screenRecording: false });

    await new ComputerUseManager().openPermissions("accessibility");
    expect(mocks.requestPermissions).toHaveBeenCalledOnce();
    expect(mocks.openExternal).toHaveBeenCalledWith(ACCESSIBILITY_PANE);
    expect(mocks.openScreenRecordingSettings).not.toHaveBeenCalled();

    mocks.openExternal.mockClear();
    await new ComputerUseManager().openPermissions("screenRecording");
    expect(mocks.openScreenRecordingSettings).toHaveBeenCalledOnce();
    expect(mocks.openExternal).not.toHaveBeenCalled();
  });
});

describe("ComputerUseManager host lifecycle", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
    vi.stubEnv("CHATDESK_CUA_DRIVER", process.execPath);
    mocks.currentPermissions.mockReturnValue({ accessibility: true, screenRecording: true });
    mocks.hostState.mockReturnValue(2);
    mocks.hostStart.mockResolvedValue(fakeConnection("gen-1"));
    mocks.hostWaitForExit.mockReturnValue(new Promise(() => {}));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("restarts the embedded host so macOS re-reads TCC", async () => {
    mocks.hostRestart.mockResolvedValue(fakeConnection("gen-2"));
    const manager = new ComputerUseManager();
    manager.setEnabledState(true);
    await manager.start();

    const status = await manager.refresh();

    expect(mocks.hostRestart).toHaveBeenCalledOnce();
    expect(mocks.hostDestroy).not.toHaveBeenCalled();
    expect(status.hostRunning).toBe(true);
    expect(status.error).toBeNull();
  });

  it("tears the host down when the restart fails", async () => {
    mocks.hostRestart.mockRejectedValue(new Error("restart failed"));
    const manager = new ComputerUseManager();
    manager.setEnabledState(true);
    await manager.start();

    const status = await manager.refresh();

    expect(status.hostRunning).toBe(false);
    expect(status.error).toBe("restart failed");
    expect(mocks.hostDestroy).toHaveBeenCalledOnce();
  });

  it("does nothing when the driver is not running", async () => {
    const status = await new ComputerUseManager().refresh();

    expect(mocks.hostRestart).not.toHaveBeenCalled();
    expect(status.hostRunning).toBe(false);
  });
});

describe("cuaDriverCandidatePaths", () => {
  const base = {
    platform: "darwin",
    appPath: "/repo/apps/electron",
    resourcesPath: "/resources",
    home: "/home/test",
    env: {},
  } as const;

  it("finds the repository-staged driver in development", () => {
    const candidates = cuaDriverCandidatePaths({ ...base, packaged: false });

    expect(candidates).toContain("/repo/apps/desktop/assets/binaries/cua-driver");
  });

  it("does not look into the source tree in a packaged app", () => {
    const candidates = cuaDriverCandidatePaths({ ...base, packaged: true });

    expect(candidates).toContain("/resources/binaries/cua-driver");
    expect(candidates.some((candidate) => candidate.includes("desktop/assets"))).toBe(false);
  });

  it("honours an explicit environment override first and the platform executable name", () => {
    const candidates = cuaDriverCandidatePaths({
      ...base,
      platform: "win32",
      packaged: false,
      env: { CHATDESK_CUA_DRIVER: "D:\\cua\\cua-driver.exe" },
    });

    expect(candidates[0]).toBe("D:\\cua\\cua-driver.exe");
    expect(candidates).toContain("/resources/binaries/cua-driver.exe");
  });
});
