import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_DEVELOPER_SETTINGS,
  normalizeDeveloperSettings,
  saveDeveloperSettings,
} from "@/lib/developer-settings";

describe("developer settings", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults new settings for legacy and invalid configurations", () => {
    expect(normalizeDeveloperSettings(null)).toEqual(DEFAULT_DEVELOPER_SETTINGS);
    expect(normalizeDeveloperSettings({ mockLongResponse: true })).toEqual({
      mockLongResponse: true,
      showAllTasks: false,
    });
  });

  it("only enables showing all tasks for a strict true value", () => {
    expect(normalizeDeveloperSettings({ showAllTasks: true }).showAllTasks).toBe(true);
    expect(normalizeDeveloperSettings({ showAllTasks: "true" }).showAllTasks).toBe(false);
    expect(normalizeDeveloperSettings({ showAllTasks: 1 }).showAllTasks).toBe(false);
  });

  it("persists normalized settings in the web fallback", async () => {
    const setItem = vi.fn();
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", {
      localStorage: { setItem },
      dispatchEvent,
    });
    vi.stubGlobal(
      "CustomEvent",
      class<T> {
        constructor(
          public type: string,
          public init: { detail: T },
        ) {}
      },
    );

    await saveDeveloperSettings({ mockLongResponse: false, showAllTasks: true });

    expect(setItem).toHaveBeenCalledWith(
      "chatdesk-developer-settings-v1",
      JSON.stringify({ mockLongResponse: false, showAllTasks: true }),
    );
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });
});
