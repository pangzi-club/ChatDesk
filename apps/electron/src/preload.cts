import { contextBridge, ipcRenderer } from "electron";

// Sandboxed Electron preloads cannot require sibling files, so keep transport constants local.
const IPC_CHANNEL = "chatdesk:invoke";
const IPC_EVENT_PREFIX = "chatdesk:event:";

type DesktopUserStoreFile = "settings.json" | "bookmarks.json";
type WhisperModelId = "tiny" | "tiny.en" | "base" | "small" | "medium" | "large-v3-turbo";

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
  requestNotificationPermission(): Promise<boolean>;
  showNotification(
    title: string,
    body: string,
    onlyWhenWindowUnfocused?: boolean,
  ): Promise<boolean>;
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
  whisperListModels(): Promise<unknown>;
  whisperDownloadModel(modelId: WhisperModelId): Promise<unknown>;
  whisperCancelDownload(modelId: WhisperModelId): Promise<void>;
  whisperDeleteModel(modelId: WhisperModelId): Promise<void>;
  whisperTranscribe(input: { modelId: WhisperModelId; language: string; samples: number[]; sampleRate: number }): Promise<unknown>;
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
  requestNotificationPermission: () =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "request_notification_permission", args: {} }),
  showNotification: (title: string, body: string, onlyWhenWindowUnfocused = true) =>
    ipcRenderer.invoke(IPC_CHANNEL, {
      command: "show_notification",
      args: { title, body, onlyWhenWindowUnfocused },
    }),
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
  whisperListModels: () => ipcRenderer.invoke(IPC_CHANNEL, { command: "whisper_list_models", args: {} }),
  whisperDownloadModel: (modelId: WhisperModelId) =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "whisper_download_model", args: { modelId } }),
  whisperCancelDownload: (modelId: WhisperModelId) =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "whisper_cancel_download", args: { modelId } }),
  whisperDeleteModel: (modelId: WhisperModelId) =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "whisper_delete_model", args: { modelId } }),
  whisperTranscribe: (input) =>
    ipcRenderer.invoke(IPC_CHANNEL, { command: "whisper_transcribe", args: input }),
};

contextBridge.exposeInMainWorld("__CHATDESK_DESKTOP_BRIDGE__", bridge);
