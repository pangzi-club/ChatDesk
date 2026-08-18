import { contextBridge, ipcRenderer } from "electron";
import { IPC_CHANNEL, IPC_EVENT_PREFIX } from "./ipc-contract.js";

type DesktopUserStoreFile = "settings.json" | "bookmarks.json";

type DesktopBridge = {
  runtime: "electron";
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
  httpRequest(request: {
    url: string;
    method: string;
    headers: Array<[string, string]>;
    body?: string;
  }): Promise<{
    status: number;
    statusText: string;
    headers: Array<[string, string]>;
    body: number[];
  }>;
  terminalSpawn(
    args: { cwd: string; cols: number; rows: number },
    onEvent: (event: unknown) => void,
  ): Promise<{ id: string; shell: string; unsubscribe: () => void }>;
};

const bridge: DesktopBridge = {
  runtime: "electron",
  call: <T,>(command: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke(IPC_CHANNEL, { command, args }) as Promise<T>,
  subscribe: async (event, listener) => {
    const channel = `${IPC_EVENT_PREFIX}${event}`;
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => listener(payload);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
  readUserStore: (fileName: DesktopUserStoreFile) =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "read_user_store", args: { fileName } }),
  writeUserStore: (fileName: DesktopUserStoreFile, contents: string) =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "write_user_store", args: { fileName, contents } }),
  selectWorkspaceDirectory: () =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "select_workspace_directory", args: {} }),
  openExternal: (url: string) =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "open_external", args: { url } }),
  assetUrl: (path: string) => `chatdesk-asset://local/?path=${encodeURIComponent(path)}`,
  saveImageFile: (bytes: number[], fileName: string) =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "save_image_file", args: { bytes, fileName } }),
  setTrayEnabled: (enabled: boolean) =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "set_tray_enabled", args: { enabled } }),
  toggleWindowMaximize: () =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "toggle_window_maximize", args: {} }),
  httpRequest: (request) => ipcRenderer.invoke(IPC_CHANNEL, { command: "http_request", args: request }),
  terminalSpawn: async (args, onEvent) => {
    const id = crypto.randomUUID();
    const channel = `${IPC_EVENT_PREFIX}terminal:${id}`;
    const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => onEvent(payload);
    ipcRenderer.on(channel, handler);
    try {
      const result = await ipcRenderer.invoke(IPC_CHANNEL, {
        command: "terminal_spawn",
        args: { ...args, id },
      });
      return {
        ...result,
        unsubscribe: () => ipcRenderer.removeListener(channel, handler),
      };
    } catch (error) {
      ipcRenderer.removeListener(channel, handler);
      throw error;
    }
  },
};

contextBridge.exposeInMainWorld("__CHATDESK_DESKTOP_BRIDGE__", bridge);
