export type DesktopRuntime = "electron";

export type DesktopUserStoreFile = "settings.json" | "bookmarks.json";

export type DesktopHttpRequest = {
  url: string;
  method: string;
  headers: Array<[string, string]>;
  body?: string;
};

export type DesktopHttpResponse = {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: number[];
};

export type DesktopTerminalEvent =
  | { type: "output"; data: string | number[] | Uint8Array }
  | { type: "exit"; code: number; signal?: string }
  | { type: "error"; message: string };

export type DesktopTerminalSpawnResult = {
  id: string;
  shell: string;
  unsubscribe?: () => void;
};

export type WhisperModelId = "tiny" | "tiny.en" | "base" | "small" | "medium" | "large-v3-turbo";
export type WhisperModelStatus = {
  id: WhisperModelId;
  installed: boolean;
  downloading: boolean;
  bytesDownloaded: number;
  totalBytes?: number;
  error?: string;
};
export type WhisperTranscriptionResult = { text: string; modelId: WhisperModelId };

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
  requestNotificationPermission?(): Promise<boolean>;
  showNotification?(
    title: string,
    body: string,
    onlyWhenWindowUnfocused?: boolean,
  ): Promise<boolean>;
  toggleWindowMaximize(): Promise<void>;
  httpRequest(request: DesktopHttpRequest): Promise<DesktopHttpResponse>;
  terminalSpawn(
    args: { cwd: string; cols: number; rows: number },
    onEvent: (event: DesktopTerminalEvent) => void,
  ): Promise<DesktopTerminalSpawnResult>;
  whisperListModels?(): Promise<{ directory: string; models: WhisperModelStatus[] }>;
  whisperDownloadModel?(modelId: WhisperModelId): Promise<WhisperModelStatus>;
  whisperCancelDownload?(modelId: WhisperModelId): Promise<void>;
  whisperDeleteModel?(modelId: WhisperModelId): Promise<void>;
  whisperTranscribe?(input: {
    modelId: WhisperModelId;
    language: string;
    samples: number[];
    sampleRate: number;
  }): Promise<WhisperTranscriptionResult>;
};
