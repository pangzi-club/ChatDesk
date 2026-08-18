import type { DesktopUserStoreFile } from "@chatdesk/shared";
import { getDesktopBridge } from "@/lib/desktop-bridge";

type JsonObject = Record<string, unknown>;

/**
 * Desktop-only JSON storage backed by the native ~/.chatdesk file service.
 * The web preview falls back to an isolated localStorage record.
 */
export class UserDataStore {
  private value: JsonObject = {};
  private loaded = false;

  constructor(private readonly fileName: DesktopUserStoreFile) {}

  private async load() {
    if (this.loaded) return;
    const bridge = getDesktopBridge();
    const contents = bridge
      ? await bridge.readUserStore(this.fileName)
      : (window.localStorage.getItem(storageKey(this.fileName)) ?? "");
    if (contents.trim()) {
      const parsed: unknown = JSON.parse(contents);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        this.value = parsed as JsonObject;
      }
    }
    this.loaded = true;
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
