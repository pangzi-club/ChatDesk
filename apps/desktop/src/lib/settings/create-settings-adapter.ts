import { isDesktop } from "@/lib/runtime/desktop-bridge";
import { settingsStore } from "@/lib/settings/settings-store";

export type SettingsAdapterPrimaryStore<T> = {
  read: () => Promise<unknown>;
  write: (value: T) => Promise<void>;
};

export type SettingsAdapterOptions<T> = {
  /** Key inside the desktop user store (settings.json). */
  storeKey?: string;
  /** localStorage key used by the web preview and as a desktop fallback. */
  storageKey: string;
  /** Keys written by older releases; read as a fallback and cleared on save. */
  legacyStorageKeys?: string[];
  /** Custom event dispatched after a save, carrying the normalized value. */
  eventName?: string;
  normalize: (value: unknown) => T;
  defaultValue: T;
  /** Human-readable name used in error logs. */
  label: string;
  /**
   * Settings whose source of truth is not the desktop user store (for example
   * the Chat Server config) supply their own async read/write pair.
   */
  primaryStore?: SettingsAdapterPrimaryStore<T>;
};

export type SettingsAdapter<T> = {
  load: () => Promise<T>;
  save: (value: T) => Promise<void>;
};

/**
 * Shared read/write behaviour for the settings modules: desktop user store
 * first, localStorage fallback, and a change event after every save. Replaces
 * the near-identical copies that used to live in each settings module.
 */
export function createSettingsAdapter<T>(options: SettingsAdapterOptions<T>): SettingsAdapter<T> {
  const {
    storeKey,
    storageKey,
    legacyStorageKeys = [],
    eventName,
    normalize,
    defaultValue,
    label,
    primaryStore,
  } = options;
  const fallbackKeys = [storageKey, ...legacyStorageKeys];

  const readFallback = (): T | undefined => {
    if (typeof window === "undefined") return undefined;
    for (const key of fallbackKeys) {
      try {
        const raw = window.localStorage.getItem(key);
        if (raw) return normalize(JSON.parse(raw));
      } catch (error) {
        console.error(`Failed to load ${label} from localStorage`, error);
      }
    }
    return undefined;
  };

  const clearFallback = () => {
    if (typeof window === "undefined") return;
    for (const key of fallbackKeys) window.localStorage.removeItem(key);
  };

  const writeFallback = (value: T) => {
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(storageKey, JSON.stringify(value));
        for (const key of legacyStorageKeys) window.localStorage.removeItem(key);
      }
    } catch (error) {
      console.error(`Failed to save ${label} to localStorage`, error);
    }
  };

  const dispatch = (value: T) => {
    if (!eventName || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent<T>(eventName, { detail: value }));
  };

  return {
    async load(): Promise<T> {
      if (primaryStore) {
        try {
          const stored = await primaryStore.read();
          if (stored !== undefined && stored !== null) return normalize(stored);
        } catch (error) {
          console.error(`Failed to load ${label} from its primary store`, error);
        }
        return readFallback() ?? defaultValue;
      }

      if (isDesktop() && storeKey) {
        try {
          const stored = await settingsStore.get<unknown>(storeKey);
          if (stored !== undefined && stored !== null) return normalize(stored);
        } catch (error) {
          console.error(`Failed to load ${label} from desktop store`, error);
        }
      }
      return readFallback() ?? defaultValue;
    },

    async save(value: T): Promise<void> {
      const normalized = normalize(value);

      if (primaryStore) {
        try {
          await primaryStore.write(normalized);
          clearFallback();
          dispatch(normalized);
          return;
        } catch (error) {
          console.error(`Failed to save ${label} to its primary store`, error);
        }
        writeFallback(normalized);
        dispatch(normalized);
        return;
      }

      if (isDesktop() && storeKey) {
        try {
          await settingsStore.set(storeKey, normalized);
          await settingsStore.save();
          clearFallback();
          dispatch(normalized);
          return;
        } catch (error) {
          console.error(`Failed to save ${label} to desktop store`, error);
        }
      }
      writeFallback(normalized);
      dispatch(normalized);
    },
  };
}
