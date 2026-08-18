export type DesktopRuntime = "tauri" | "electron";

export type DesktopUserStoreFile = "settings.json" | "bookmarks.json";

export type DesktopBridge = {
  runtime: DesktopRuntime;
  call<T>(command: string, args?: Record<string, unknown>): Promise<T>;
  subscribe(event: string, listener: (payload: unknown) => void): Promise<() => void>;
  readUserStore(fileName: DesktopUserStoreFile): Promise<string>;
  writeUserStore(fileName: DesktopUserStoreFile, contents: string): Promise<void>;
  selectWorkspaceDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<void>;
  assetUrl(path: string): string;
  saveImageFile(bytes: number[], fileName: string): Promise<boolean>;
  setTrayEnabled(enabled: boolean): Promise<void>;
  toggleWindowMaximize(): Promise<void>;
};
