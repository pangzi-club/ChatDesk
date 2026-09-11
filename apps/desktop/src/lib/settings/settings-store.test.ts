import { afterEach, describe, expect, it, vi } from "vitest";
import { UserDataStore } from "@/lib/settings/settings-store";

function stubBridge(contents: string) {
  const readUserStore = vi.fn().mockResolvedValue(contents);
  const writeUserStore = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("window", {
    __CHATDESK_DESKTOP_BRIDGE__: { runtime: "electron", readUserStore, writeUserStore },
    localStorage: { getItem: vi.fn(), setItem: vi.fn() },
  });
  return { readUserStore, writeUserStore };
}

describe("UserDataStore", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads values from a valid store", async () => {
    stubBridge('{"theme":"dark"}');
    const store = new UserDataStore("settings.json");

    await expect(store.get("theme")).resolves.toBe("dark");
    await expect(store.get("missing")).resolves.toBeUndefined();
  });

  it("ignores payloads that are not JSON objects", async () => {
    stubBridge("[1,2,3]");
    const store = new UserDataStore("settings.json");

    await expect(store.get("theme")).resolves.toBeUndefined();
  });

  it("recovers from a corrupt store instead of failing every read and write", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const { readUserStore, writeUserStore } = stubBridge('{"theme":');
    const store = new UserDataStore("settings.json");

    await expect(store.get("theme")).resolves.toBeUndefined();
    await store.set("theme", "dark");
    await store.save();

    expect(consoleError).toHaveBeenCalledOnce();
    expect(readUserStore).toHaveBeenCalledTimes(1);
    expect(writeUserStore).toHaveBeenCalledWith("settings.json", '{\n  "theme": "dark"\n}');
  });

  it("shares a single bridge read across concurrent callers", async () => {
    const { readUserStore } = stubBridge('{"theme":"dark"}');
    const store = new UserDataStore("settings.json");

    await expect(
      Promise.all([store.get("theme"), store.get("theme"), store.get("theme")]),
    ).resolves.toEqual(["dark", "dark", "dark"]);
    expect(readUserStore).toHaveBeenCalledTimes(1);
  });

  it("retries the bridge read after a read failure", async () => {
    const readUserStore = vi
      .fn()
      .mockRejectedValueOnce(new Error("bridge down"))
      .mockResolvedValueOnce('{"theme":"dark"}');
    vi.stubGlobal("window", {
      __CHATDESK_DESKTOP_BRIDGE__: { runtime: "electron", readUserStore, writeUserStore: vi.fn() },
      localStorage: { getItem: vi.fn(), setItem: vi.fn() },
    });
    const store = new UserDataStore("settings.json");

    await expect(store.get("theme")).rejects.toThrow("bridge down");
    await expect(store.get("theme")).resolves.toBe("dark");
    expect(readUserStore).toHaveBeenCalledTimes(2);
  });
});
