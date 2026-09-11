import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSettingsAdapter,
  type SettingsAdapterPrimaryStore,
} from "@/lib/settings/create-settings-adapter";

type TestSettings = { enabled: boolean };
const DEFAULT_TEST_SETTINGS: TestSettings = { enabled: false };

function normalizeTestSettings(value: unknown): TestSettings {
  if (!value || typeof value !== "object") return DEFAULT_TEST_SETTINGS;
  return { enabled: (value as Record<string, unknown>).enabled === true };
}

function stubWindow(storage: Record<string, string> = {}) {
  const setItem = vi.fn();
  const removeItem = vi.fn();
  const dispatchEvent = vi.fn();
  const localStorage = {
    getItem: vi.fn((key: string) => storage[key] ?? null),
    removeItem,
    setItem,
  };
  vi.stubGlobal("window", { dispatchEvent, localStorage });
  vi.stubGlobal(
    "CustomEvent",
    class<T> {
      constructor(
        public type: string,
        public init: { detail: T },
      ) {}
    },
  );
  return { dispatchEvent, removeItem, setItem };
}

function makeAdapter(primaryStore?: SettingsAdapterPrimaryStore<TestSettings>) {
  return createSettingsAdapter<TestSettings>({
    storeKey: "test",
    storageKey: "chatdesk-test-v1",
    eventName: "test-change",
    legacyStorageKeys: ["m-dashboard-test-v1"],
    normalize: normalizeTestSettings,
    defaultValue: DEFAULT_TEST_SETTINGS,
    label: "test settings",
    ...(primaryStore ? { primaryStore } : {}),
  });
}

describe("createSettingsAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the current and legacy localStorage keys when no desktop store exists", async () => {
    stubWindow({ "m-dashboard-test-v1": JSON.stringify({ enabled: true }) });

    await expect(makeAdapter().load()).resolves.toEqual({ enabled: true });
  });

  it("defaults when nothing has been persisted", async () => {
    stubWindow();

    await expect(makeAdapter().load()).resolves.toEqual(DEFAULT_TEST_SETTINGS);
  });

  it("prefers the primary store and clears the localStorage fallback on save", async () => {
    const { dispatchEvent, removeItem, setItem } = stubWindow();
    const write = vi.fn().mockResolvedValue(undefined);
    const adapter = makeAdapter({
      read: vi.fn().mockResolvedValue({ enabled: true }),
      write,
    });

    await expect(adapter.load()).resolves.toEqual({ enabled: true });
    await adapter.save({ enabled: true });

    expect(write).toHaveBeenCalledWith({ enabled: true });
    expect(setItem).not.toHaveBeenCalled();
    expect(removeItem).toHaveBeenCalledWith("chatdesk-test-v1");
    expect(removeItem).toHaveBeenCalledWith("m-dashboard-test-v1");
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });

  it("falls back to localStorage when the primary store read fails", async () => {
    stubWindow({ "chatdesk-test-v1": JSON.stringify({ enabled: true }) });
    const adapter = makeAdapter({
      read: vi.fn().mockRejectedValue(new Error("offline")),
      write: vi.fn().mockResolvedValue(undefined),
    });

    await expect(adapter.load()).resolves.toEqual({ enabled: true });
  });

  it("persists to localStorage when the primary store write fails", async () => {
    const { dispatchEvent, setItem } = stubWindow();
    const adapter = makeAdapter({
      read: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockRejectedValue(new Error("offline")),
    });

    await adapter.save({ enabled: true });

    expect(setItem).toHaveBeenCalledWith("chatdesk-test-v1", JSON.stringify({ enabled: true }));
    expect(dispatchEvent).toHaveBeenCalledOnce();
  });
});
