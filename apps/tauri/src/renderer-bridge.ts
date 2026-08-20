import {
  Channel,
  convertFileSrc,
  invoke,
  isTauri,
} from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { openUrl } from "@tauri-apps/plugin-opener";
import type {
  DesktopBridge,
  DesktopHttpRequest,
  DesktopHttpResponse,
  DesktopTerminalEvent,
  DesktopTerminalSpawnResult,
} from "@chatdesk/shared";

declare global {
  interface Window {
    __CHATDESK_DESKTOP_BRIDGE__?: DesktopBridge;
  }
}

const tauriBridge: DesktopBridge = {
  runtime: "tauri",
  call: <T>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args),
  subscribe: async (event, listener) => {
    const unlisten = await listen(event, (event) => listener(event.payload));
    return unlisten;
  },
  readUserStore: (fileName) => invoke<string>("read_user_store", { fileName }),
  writeUserStore: (fileName, contents) => invoke("write_user_store", { fileName, contents }),
  selectWorkspaceDirectory: () => invoke<string | null>("select_workspace_directory"),
  openExternal: (url) => openUrl(url),
  assetUrl: (path) => convertFileSrc(path),
  saveImageFile: (bytes, fileName) => invoke<boolean>("save_image_file", { bytes, fileName }),
  toggleWindowMaximize: () => getCurrentWindow().toggleMaximize(),
  httpRequest: requestHttp,
  terminalSpawn: (args, onEvent) => {
    const channel = new Channel<DesktopTerminalEvent>();
    channel.onmessage = onEvent;
    return invoke<DesktopTerminalSpawnResult>("terminal_spawn", {
      ...args,
      onEvent: channel,
    }).then((result) => ({ ...result, unsubscribe: () => undefined }));
  },
};

export function installTauriBridge() {
  if (!isTauri()) return false;
  window.__CHATDESK_DESKTOP_BRIDGE__ = tauriBridge;
  return true;
}

async function requestHttp(request: DesktopHttpRequest): Promise<DesktopHttpResponse> {
  const response = await tauriFetch(request.url, {
    method: request.method,
    headers: request.headers,
    ...(request.body === undefined ? {} : { body: request.body }),
  });
  return {
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    body: [...new Uint8Array(await response.arrayBuffer())],
  };
}
