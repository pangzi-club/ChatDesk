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

export type ComputerUsePermissionStatus = {
  accessibility: boolean;
  screenRecording: boolean;
};

/** Which macOS settings pane a permission request should open. */
export type ComputerUsePermissionTarget = "accessibility" | "screenRecording";

/**
 * The macOS identity that currently owns the Accessibility and Screen Recording
 * grants. Embedded drivers never prompt and never own a grant row, so the host
 * app is what the user has to authorize.
 */
export type ComputerUsePermissionOwner = {
  name: string;
  bundleId: string;
  packaged: boolean;
};

export type ComputerUseStatus = {
  supported: boolean;
  enabled: boolean;
  driverInstalled: boolean;
  driverPath: string | null;
  hostRunning: boolean;
  permissions: ComputerUsePermissionStatus;
  permissionOwner: ComputerUsePermissionOwner;
  error: string | null;
};

/**
 * Raw material for one external plugin directory, read by the Electron host.
 * The renderer validates the manifest and the entry syntax; this payload only
 * carries file contents plus a stable directory identity.
 */
export type ExternalPluginScanItem = {
  id: string;
  directory: string;
  manifestJson: string | null;
  entrySource: string | null;
  error: string | null;
};

export type ExternalPluginScanResult = {
  supported: boolean;
  plugins: ExternalPluginScanItem[];
};

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
  computerUseStatus?(): Promise<ComputerUseStatus>;
  setComputerUseEnabled?(enabled: boolean): Promise<ComputerUseStatus>;
  openComputerUsePermissions?(target?: ComputerUsePermissionTarget): Promise<ComputerUseStatus>;
  httpRequest(request: DesktopHttpRequest): Promise<DesktopHttpResponse>;
  scanExternalPlugins?(directories: string[]): Promise<ExternalPluginScanResult>;
  revealPluginDirectory?(directory: string): Promise<void>;
  terminalSpawn(
    args: { cwd: string; cols: number; rows: number },
    onEvent: (event: DesktopTerminalEvent) => void,
  ): Promise<DesktopTerminalSpawnResult>;
};
