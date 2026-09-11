import type { DesktopUserStoreFile } from "@chatdesk/shared";
import { getDesktopBridge } from "@/lib/runtime/desktop-bridge";

type JsonObject = Record<string, unknown>;

/**
 * Desktop-only JSON storage backed by the native ~/.chatdesk file service.
 * The web preview falls back to an isolated localStorage record.
 */
export class UserDataStore {
  private value: JsonObject = {};
  private loaded = false;
  private loading: Promise<void> | null = null;

  constructor(private readonly fileName: DesktopUserStoreFile) {}

  private async load() {
    if (this.loaded) return;
    if (!this.loading) {
      // Concurrent get/set/save calls share one bridge read instead of each
      // issuing their own; a failed read clears the slot so a later call can
      // retry, while a corrupt payload is recovered inside readValue().
      this.loading = this.readValue()
        .then(() => {
          this.loaded = true;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    await this.loading;
  }

  private async readValue() {
    const bridge = getDesktopBridge();
    const contents = bridge
      ? await bridge.readUserStore(this.fileName)
      : typeof window !== "undefined"
        ? (window.localStorage.getItem(storageKey(this.fileName)) ?? "")
        : "";
    if (!contents.trim()) return;
    try {
      const parsed: unknown = JSON.parse(contents);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        this.value = parsed as JsonObject;
      }
    } catch (error) {
      // A truncated or hand-edited store must not brick every read and write:
      // fall back to an empty record so the app still starts, and let the next
      // save overwrite the broken file.
      console.error(`Failed to parse user store "${this.fileName}"; using defaults`, error);
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    await this.load();
    return this.value[key] as T | undefined;
  }

  async set(key: string, value: unknown) {
    await this.load();
    this.value[key] = value;
  }

  async delete(key: string) {
    await this.load();
    const existed = key in this.value;
    delete this.value[key];
    return existed;
  }

  async save() {
    await this.load();
    const contents = JSON.stringify(this.value, null, 2);
    const bridge = getDesktopBridge();
    if (bridge) {
      await bridge.writeUserStore(this.fileName, contents);
    } else {
      if (typeof window !== "undefined")
        window.localStorage.setItem(storageKey(this.fileName), contents);
    }
  }
}

function storageKey(fileName: string) {
  return `chatdesk-user-store:${fileName}`;
}

export const settingsStore = new UserDataStore("settings.json");

export function createUserDataStore(fileName: DesktopUserStoreFile) {
  return new UserDataStore(fileName);
}
