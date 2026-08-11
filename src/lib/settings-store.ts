import { invoke } from "@tauri-apps/api/core";

type JsonObject = Record<string, unknown>;

/**
 * Desktop-only JSON storage backed by the native ~/.chatdesk file service.
 * The web preview intentionally falls back to localStorage in each owning module.
 */
export class UserDataStore {
  private value: JsonObject = {};
  private loaded = false;

  constructor(private readonly fileName: "settings.json" | "bookmarks.json") {}

  private async load() {
    if (this.loaded) return;
    const contents = await invoke<string>("read_user_store", { fileName: this.fileName });
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
    await invoke("write_user_store", {
      fileName: this.fileName,
      contents: JSON.stringify(this.value, null, 2),
    });
  }
}

export const settingsStore = new UserDataStore("settings.json");

export function createUserDataStore(fileName: "settings.json" | "bookmarks.json") {
  return new UserDataStore(fileName);
}
