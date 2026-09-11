import type { ComputerUseStatus } from "@chatdesk/shared";
import { getDesktopBridge, subscribeBridgeEvent } from "@/lib/runtime/desktop-bridge";

const COMPUTER_USE_STATUS_EVENT = "computer-use-status";

/** Fallback status used when the desktop bridge exposes no Computer Use API. */
const UNSUPPORTED_STATUS: ComputerUseStatus = {
  supported: false,
  enabled: false,
  driverInstalled: false,
  driverPath: null,
  hostRunning: false,
  permissions: { accessibility: false, screenRecording: false },
  error: null,
};

export async function loadComputerUseStatus(): Promise<ComputerUseStatus> {
  const bridge = getDesktopBridge();
  if (!bridge?.computerUseStatus) return UNSUPPORTED_STATUS;
  return bridge.computerUseStatus();
}

export async function setComputerUseEnabled(enabled: boolean): Promise<ComputerUseStatus> {
  const bridge = getDesktopBridge();
  if (!bridge?.setComputerUseEnabled) throw new Error("当前运行环境不支持 Computer Use");
  return bridge.setComputerUseEnabled(enabled);
}

export async function openComputerUsePermissions(): Promise<ComputerUseStatus> {
  const bridge = getDesktopBridge();
  if (!bridge?.openComputerUsePermissions) throw new Error("当前运行环境不支持权限设置");
  return bridge.openComputerUsePermissions();
}

export function subscribeComputerUseStatus(
  listener: (status: ComputerUseStatus) => void,
): () => void {
  return subscribeBridgeEvent(COMPUTER_USE_STATUS_EVENT, (payload) => {
    listener(payload as ComputerUseStatus);
  });
}
