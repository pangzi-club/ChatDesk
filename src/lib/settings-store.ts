import { LazyStore } from "@tauri-apps/plugin-store";

// Keep one LazyStore instance for the shared settings file so its cache stays coherent.
export const settingsStore = new LazyStore("settings.json");
