import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadGeneralSettings,
  notifyChatCompletion,
  requestNotificationPermission,
} from "@/lib/general-settings";

function stubWindow(requestResult: boolean) {
  const requestPermissionBridge = vi.fn().mockResolvedValue(requestResult);
  const showNotification = vi.fn().mockResolvedValue(requestResult);
  vi.stubGlobal("window", {
    __CHATDESK_DESKTOP_BRIDGE__: {
      runtime: "electron",
      readUserStore: vi.fn().mockResolvedValue(""),
      requestNotificationPermission: requestPermissionBridge,
      showNotification,
    },
    localStorage: {
      getItem: vi.fn().mockReturnValue(
        JSON.stringify({
          notifyOnChatCompletion: true,
          notifyOnlyWhenWindowUnfocused: true,
        }),
      ),
    },
  });
  return { requestPermissionBridge, showNotification };
}

describe("general notification settings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("treats legacy completion notification settings as unverified and disabled", async () => {
    stubWindow(false);

    await expect(loadGeneralSettings()).resolves.toMatchObject({
      notifyOnChatCompletion: false,
      notificationPermissionVerified: false,
    });
  });

  it("asks the main process to display a verification notification", async () => {
    const { requestPermissionBridge } = stubWindow(true);

    await expect(requestNotificationPermission()).resolves.toBe(true);
    expect(requestPermissionBridge).toHaveBeenCalledOnce();
  });

  it("reports whether a completion notification was shown", async () => {
    const { showNotification } = stubWindow(false);

    await expect(notifyChatCompletion("会话标题", true)).resolves.toBe(false);
    expect(showNotification).toHaveBeenCalledWith("对话已完成", "会话标题", true);
  });
});
