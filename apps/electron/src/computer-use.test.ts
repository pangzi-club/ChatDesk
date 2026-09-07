import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentPermissions: vi.fn(),
  requestPermissions: vi.fn(),
  openScreenRecordingSettings: vi.fn(),
  openExternal: vi.fn(),
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
  EmbeddedCuaDriverHost: class EmbeddedCuaDriverHost {},
  EmbeddedDriverHostState: { Ready: 2 },
}));

vi.mock("electron", () => ({
  app: {
    getAppPath: () => "/app",
    getPath: () => "/home/test",
  },
  shell: { openExternal: mocks.openExternal },
}));

import { ComputerUseManager } from "./computer-use.js";

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
    expect(mocks.openExternal).toHaveBeenCalledWith(
      "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
    );
  });
});
