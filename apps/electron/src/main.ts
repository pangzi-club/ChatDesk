import { ChatServerSupervisor } from "@chatdesk/desktop-host";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  Notification,
  protocol,
  screen,
  shell,
  Tray,
  webFrameMain,
} from "electron";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  IPC_CHANNEL,
  IPC_EVENT_PREFIX,
  validateAssetPath,
  validateExternalUrl,
  validateUserStoreFile,
} from "./ipc-contract.js";
import { chatServerLaunchArgs, chatServerRuntimeRoot } from "./chat-server-launch.js";
import { performHttpRequest } from "./http-bridge.js";
import {
  chatServerProxyUrl,
  isEmbeddedWindowOpen,
  isChatServerProxyPath,
  isRendererNavigation,
  RENDERER_SCHEME,
  rendererFileUrl,
  rendererLoadUrl,
  resolveRendererFile,
} from "./renderer-protocol.js";
import { TerminalManager } from "./terminal-manager.js";
import { createTrayIconBuffer, padTrayMenuLabel } from "./tray-icon.js";

type DesktopUserStoreFile = "settings.json" | "bookmarks.json";
type WindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  isMaximized: boolean;
};

const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 720;
const MIN_WINDOW_WIDTH = 480;
const MIN_WINDOW_HEIGHT = 320;
const MAX_WINDOW_DIMENSION = 10000;
const WINDOW_SHOW_FALLBACK_MS = 5_000;
const NOTIFICATION_RESULT_TIMEOUT_MS = 60_000;
const NOTIFICATION_RETENTION_MS = 10 * 60_000;
let windowStateSaveTimer: NodeJS.Timeout | undefined;
const activeNotifications = new Set<Notification>();

function showNativeNotification(title: string, body: string) {
  if (!Notification.isSupported()) return Promise.resolve(false);
  return new Promise<boolean>((resolve) => {
    const notification = new Notification({ title, body });
    activeNotifications.add(notification);
    const retentionTimer = setTimeout(() => activeNotifications.delete(notification), NOTIFICATION_RETENTION_MS);
    retentionTimer.unref();

    let settled = false;
    const settle = (shown: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(resultTimer);
      notification.removeAllListeners("show");
      notification.removeAllListeners("failed");
      resolve(shown);
    };
    const resultTimer = setTimeout(() => settle(false), NOTIFICATION_RESULT_TIMEOUT_MS);
    resultTimer.unref();
    notification.once("show", () => settle(true));
    notification.once("failed", (_event, error) => {
      console.error("Failed to show desktop notification", error);
      activeNotifications.delete(notification);
      settle(false);
    });
    notification.once("close", () => activeNotifications.delete(notification));
    notification.show();
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_SCHEME,
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
  {
    scheme: "chatdesk-asset",
    privileges: { secure: true, standard: true, supportFetchAPI: true },
  },
]);
if (!app.isPackaged) {
  const developmentAppName = "ChatDesk Dev";
  const developmentUserData = join(app.getPath("appData"), developmentAppName);
  mkdirSync(developmentUserData, { recursive: true, mode: 0o700 });
  app.setName(developmentAppName);
  app.setPath("userData", developmentUserData);
}

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let trayIcon: ReturnType<typeof nativeImage.createEmpty> | null = null;
let supervisor: ChatServerSupervisor | null = null;
let quitting = false;
const terminalManager = new TerminalManager((id, event) => emit(`terminal:${id}`, event));

function userDataDirectory() {
  return join(app.getPath("home"), ".chatdesk");
}

function userStorePath(fileName: DesktopUserStoreFile) {
  return join(userDataDirectory(), fileName);
}

function windowStatePath() {
  return join(app.getPath("userData"), "window-state.json");
}

function readWindowState(): WindowState | null {
  try {
    const value: unknown = JSON.parse(readFileSync(windowStatePath(), "utf8"));
    if (!value || typeof value !== "object") return null;
    const state = value as Partial<WindowState>;
    const { x, y, width, height, isMaximized } = state;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number" ||
      ![x, y, width, height].every(Number.isFinite) ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < MIN_WINDOW_WIDTH ||
      height < MIN_WINDOW_HEIGHT ||
      width > MAX_WINDOW_DIMENSION ||
      height > MAX_WINDOW_DIMENSION ||
      typeof isMaximized !== "boolean"
    ) {
      return null;
    }
    return { x, y, width, height, isMaximized };
  } catch {
    return null;
  }
}

function isWindowStateVisible(state: WindowState) {
  return screen.getAllDisplays().some(({ workArea }) => {
    const overlapWidth =
      Math.min(state.x + state.width, workArea.x + workArea.width) - Math.max(state.x, workArea.x);
    const overlapHeight =
      Math.min(state.y + state.height, workArea.y + workArea.height) - Math.max(state.y, workArea.y);
    return overlapWidth >= 64 && overlapHeight >= 64;
  });
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  try {
    const bounds = mainWindow.getNormalBounds();
    const target = windowStatePath();
    mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
    const temporary = `${target}.${process.pid}.tmp`;
    writeFileSync(
      temporary,
      JSON.stringify({ ...bounds, isMaximized: mainWindow.isMaximized() } satisfies WindowState),
      { mode: 0o600 },
    );
    renameSync(temporary, target);
    if (process.platform !== "win32") chmodSync(target, 0o600);
  } catch (error) {
    console.error("保存窗口状态失败", error);
  }
}

function scheduleSaveWindowState() {
  if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
  windowStateSaveTimer = setTimeout(() => {
    windowStateSaveTimer = undefined;
    saveWindowState();
  }, 250);
}

function rendererRoot() {
  const candidates = [
    join(process.resourcesPath, "desktop/dist"),
    join(app.getAppPath(), "apps/desktop/dist"),
    join(app.getAppPath(), "desktop/dist"),
    join(moduleDirectory, "../../desktop/dist"),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, "index.html")));
}

function rendererEntry() {
  if (process.env.CHATDESK_RENDERER_URL) return process.env.CHATDESK_RENDERER_URL;
  if (!rendererRoot()) throw new Error("找不到 Electron renderer 构建产物");
  return rendererLoadUrl();
}

function applicationIconPath() {
  const fileName = process.platform === "win32" ? "icon.ico" : "icon.png";
  const candidates = [
    join(process.resourcesPath, `icons/${fileName}`),
    join(app.getAppPath(), `apps/desktop/assets/icons/${fileName}`),
    join(moduleDirectory, `../../desktop/assets/icons/${fileName}`),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

function createWindow() {
  const entry = rendererEntry();
  const iconPath = process.platform === "darwin" ? undefined : applicationIconPath();
  const savedState = readWindowState();
  const restoredState = savedState && isWindowStateVisible(savedState) ? savedState : null;
  const window = new BrowserWindow({
    ...(restoredState
      ? {
          x: restoredState.x,
          y: restoredState.y,
          width: restoredState.width,
          height: restoredState.height,
        }
      : { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT }),
    show: false,
    title: "ChatDesk",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(moduleDirectory, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow = window;
  if (restoredState?.isMaximized) window.maximize();

  window.webContents.setWindowOpenHandler(({ referrer, url }) => {
    try {
      const validatedUrl = validateExternalUrl(url);
      const focusedFrame = window.webContents.focusedFrame;
      const hasEmbeddedOpenerFrame = Boolean(focusedFrame?.parent && focusedFrame.name);
      if (isEmbeddedWindowOpen(referrer.url, entry, hasEmbeddedOpenerFrame)) {
        emit("browser-preview-open", { newTab: true, url: validatedUrl });
      } else {
        void shell.openExternal(validatedUrl);
      }
    } catch {
      // Invalid protocols are denied below.
    }
    return { action: "deny" };
  });
  const emitBrowserFrameNavigation = (
    url: string,
    frameProcessId: number,
    frameRoutingId: number,
  ) => {
    const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
    if (
      !frame ||
      !frame.name ||
      frame.parent?.frameTreeNodeId !== window.webContents.mainFrame.frameTreeNodeId
    ) {
      return;
    }
    try {
      emit("browser-frame-navigate", {
        frameName: frame.name,
        url: validateExternalUrl(url),
      });
    } catch {
      // Ignore non-HTTP(S) frame navigations.
    }
  };
  window.webContents.on(
    "did-frame-navigate",
    (_event, url, _httpResponseCode, _httpStatusText, isMainFrame, processId, routingId) => {
      if (!isMainFrame) emitBrowserFrameNavigation(url, processId, routingId);
    },
  );
  window.webContents.on(
    "did-navigate-in-page",
    (_event, url, isMainFrame, processId, routingId) => {
      if (!isMainFrame) emitBrowserFrameNavigation(url, processId, routingId);
    },
  );
  window.webContents.on("will-navigate", (event, url) => {
    if (!isRendererNavigation(url, entry)) event.preventDefault();
  });
  let showFallbackTimer: NodeJS.Timeout | undefined;
  const showWindow = () => {
    if (showFallbackTimer) clearTimeout(showFallbackTimer);
    showFallbackTimer = undefined;
    if (window.isDestroyed()) return;
    window.show();
    window.focus();
  };
  window.once("ready-to-show", showWindow);
  showFallbackTimer = setTimeout(showWindow, WINDOW_SHOW_FALLBACK_MS);
  window.on("close", (event) => {
    saveWindowState();
    if (!quitting) {
      event.preventDefault();
      window.hide();
    }
  });
  window.on("move", scheduleSaveWindowState);
  window.on("resize", scheduleSaveWindowState);
  window.on("maximize", scheduleSaveWindowState);
  window.on("unmaximize", scheduleSaveWindowState);
  window.on("closed", () => {
    if (showFallbackTimer) clearTimeout(showFallbackTimer);
    if (mainWindow === window) mainWindow = null;
  });
  void window.loadURL(entry).catch((error) => {
    console.error("Renderer load failed", error);
    showWindow();
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function emit(event: string, payload: unknown) {
  mainWindow?.webContents.send(`${IPC_EVENT_PREFIX}${event}`, payload);
}

function resolveChatServerWorker() {
  const candidates = [
    process.env.CHATDESK_CHAT_SERVER_WORKER,
    join(process.resourcesPath, "workers/chat-server.cjs"),
    join(process.resourcesPath, "node-runtime/workers/chat-server.cjs"),
    join(app.getAppPath(), "apps/server/.cache/chat-server.cjs"),
    join(moduleDirectory, "../../server/.cache/chat-server.cjs"),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const worker = candidates.find((candidate) => existsSync(candidate));
  if (!worker) throw new Error("找不到 Chat Server worker");
  return worker;
}

function resolveNodeRuntime(worker: string) {
  const packagedBinaries = join(process.resourcesPath, "binaries");
  const packagedRuntime = existsSync(packagedBinaries)
    ? readdirSync(packagedBinaries)
        .filter((fileName) => fileName.startsWith("node-runtime-"))
        .map((fileName) => join(packagedBinaries, fileName))[0]
    : undefined;
  const candidates = [
    process.env.CHATDESK_NODE_RUNTIME,
    packagedRuntime,
    process.execPath,
  ].filter((candidate): candidate is string => Boolean(candidate));
  return candidates.find((candidate) => candidate === process.execPath || existsSync(candidate)) ?? process.execPath;
}

function chatServerRuntimeEnvironment(worker: string, usingElectronRuntime: boolean) {
  const runtimeRoot = chatServerRuntimeRoot(
    worker,
    process.env.CHATDESK_CHAT_SERVER_RUNTIME_ROOT,
  );
  const browserWorker = join(runtimeRoot, "workers/browser-worker.mjs");
  const sandboxWorker = join(runtimeRoot, "workers/chat-server-sandbox.cjs");
  const playwrightBrowsers =
    process.env.CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH ||
    join(process.resourcesPath, "playwright-browsers");
  return {
    ...(usingElectronRuntime ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    ...(existsSync(browserWorker) ? { CHAT_SERVER_BROWSER_WORKER: browserWorker } : {}),
    ...(existsSync(sandboxWorker) ? { CHAT_SERVER_SANDBOX_WORKER: sandboxWorker } : {}),
    ...(existsSync(join(runtimeRoot, "node_modules")) ? { CHAT_SERVER_SHARP_PATH: runtimeRoot } : {}),
    ...(existsSync(playwrightBrowsers)
      ? { CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsers }
      : {}),
  };
}

function supervisorPort() {
  const port = Number(process.env.CHAT_SERVER_PORT);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : undefined;
}

function supervisorToken() {
  return process.env.CHATDESK_CHAT_SERVER_TOKEN || process.env.CHAT_SERVER_TOKEN || undefined;
}

async function setupSupervisor() {
  const worker = resolveChatServerWorker();
  const nodeRuntime = resolveNodeRuntime(worker);
  const usingElectronRuntime = nodeRuntime === process.execPath;
  const watch = process.env.CHATDESK_CHAT_SERVER_WATCH === "1";
  supervisor = new ChatServerSupervisor({
    command: nodeRuntime,
    args: chatServerLaunchArgs(worker, watch),
    cwd: dirname(worker),
    dataDir: join(userDataDirectory(), "chat-server"),
    env: chatServerRuntimeEnvironment(worker, usingElectronRuntime),
    production: !watch,
    ...(supervisorPort() ? { port: supervisorPort() } : {}),
    ...(supervisorToken() ? { token: supervisorToken() } : {}),
  });
  supervisor.subscribe((info) => emit("chat-server-state", info));
  await supervisor.start();
}

function ensureUserDataDirectory() {
  mkdirSync(userDataDirectory(), { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") chmodSync(userDataDirectory(), 0o700);
}

function readUserStore(fileName: DesktopUserStoreFile) {
  ensureUserDataDirectory();
  try {
    return readFileSync(userStorePath(fileName), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
    throw error;
  }
}

function writeUserStore(fileName: DesktopUserStoreFile, contents: string) {
  ensureUserDataDirectory();
  const target = userStorePath(fileName);
  const temporary = `${target}.${process.pid}.tmp`;
  writeFileSync(temporary, contents, { mode: 0o600 });
  renameSync(temporary, target);
  if (process.platform !== "win32") chmodSync(target, 0o600);
}

function createTrayIconImage() {
  const { png, scaleFactor, template } = createTrayIconBuffer(process.platform);
  const image = nativeImage.createFromBuffer(png, { scaleFactor });
  if (template) image.setTemplateImage(true);
  return image;
}

function openFromTray(path?: string) {
  showMainWindow();
  if (path) emit("tray-open", { path });
}

function ensureTray() {
  if (tray) {
    if (trayIcon && !trayIcon.isEmpty()) tray.setImage(trayIcon);
    return;
  }
  trayIcon = createTrayIconImage();
  tray = new Tray(trayIcon);
  if (!trayIcon.isEmpty()) tray.setImage(trayIcon);
  tray.setToolTip("ChatDesk");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: padTrayMenuLabel("显示 ChatDesk"), click: () => showMainWindow() },
      { type: "separator" },
      { label: padTrayMenuLabel("Chat"), click: () => openFromTray("/chat") },
      { label: padTrayMenuLabel("Image"), click: () => openFromTray("/image-generation") },
      { label: padTrayMenuLabel("Automations"), click: () => openFromTray("/automations") },
      { label: padTrayMenuLabel("设置"), click: () => openFromTray("/settings/general") },
      { type: "separator" },
      { label: padTrayMenuLabel("退出 ChatDesk"), click: () => app.quit() },
    ]),
  );
}

function setupIpc() {
  ipcMain.handle(IPC_CHANNEL, async (event, request: { command?: unknown; args?: unknown }) => {
    if (!mainWindow || event.sender !== mainWindow.webContents) {
      throw new Error("拒绝非主窗口的 IPC 调用");
    }
    const command = request?.command;
    const args =
      request?.args && typeof request.args === "object"
        ? (request.args as Record<string, unknown>)
        : {};
    switch (command) {
      case "read_user_store":
        return readUserStore(validateUserStoreFile(args.fileName));
      case "write_user_store": {
        const fileName = validateUserStoreFile(args.fileName);
        if (typeof args.contents !== "string") throw new Error("用户数据内容必须是字符串");
        writeUserStore(fileName, args.contents);
        return undefined;
      }
      case "select_workspace_directory": {
        const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
        return result.canceled ? null : (result.filePaths[0] ?? null);
      }
      case "open_external":
        await shell.openExternal(validateExternalUrl(args.url));
        return undefined;
      case "save_image_file": {
        if (!Array.isArray(args.bytes) || typeof args.fileName !== "string") {
          throw new Error("图片参数无效");
        }
        const result = await dialog.showSaveDialog({
          defaultPath: basename(args.fileName),
          filters: [{ name: "PNG image", extensions: ["png"] }],
        });
        if (result.canceled || !result.filePath) return false;
        const bytes = args.bytes.map((value) => {
          const byte = Number(value);
          if (!Number.isInteger(byte) || byte < 0 || byte > 255) throw new Error("图片字节无效");
          return byte;
        });
        writeFileSync(result.filePath, Buffer.from(bytes));
        return true;
      }
      case "request_notification_permission":
        return showNativeNotification(
          "ChatDesk 通知已开启",
          "对话完成后会通过系统通知提醒你。",
        );
      case "show_notification":
        if (
          typeof args.title !== "string" ||
          typeof args.body !== "string" ||
          (args.onlyWhenWindowUnfocused !== undefined &&
            typeof args.onlyWhenWindowUnfocused !== "boolean")
        ) {
          throw new Error("通知参数无效");
        }
        if (args.onlyWhenWindowUnfocused === true && mainWindow?.isFocused()) return true;
        return showNativeNotification(args.title, args.body);
      case "toggle_window_maximize":
        if (mainWindow?.isMaximized()) mainWindow.unmaximize();
        else mainWindow?.maximize();
        return undefined;
      case "chat_server_info":
        return supervisor?.info() ?? null;
      case "chat_server_restart":
        return supervisor?.restart() ?? null;
      case "chat_server_stop":
        return supervisor?.stop() ?? null;
      case "terminal_spawn":
        return terminalManager.spawnSession({
          id: args.id,
          cwd: args.cwd,
          cols: args.cols,
          rows: args.rows,
        });
      case "terminal_write":
        terminalManager.write(args.id, args.data);
        return undefined;
      case "terminal_resize":
        terminalManager.resize(args.id, args.cols, args.rows);
        return undefined;
      case "terminal_close":
        terminalManager.close(args.id);
        return undefined;
      case "http_request":
        return performHttpRequest(
          { url: args.url, method: args.method, headers: args.headers, body: args.body },
          (input, init) => net.fetch(String(input), init),
        );
      default:
        throw new Error(`未知的宿主命令：${String(command)}`);
    }
  });
}

function setupRendererProtocol() {
  if (process.env.CHATDESK_RENDERER_URL) return;
  const root = rendererRoot();
  if (!root) throw new Error("找不到 Electron renderer 构建产物");
  protocol.handle(RENDERER_SCHEME, async (request) => {
    let chatServerRequest = false;
    try {
      const requestUrl = new URL(request.url);
      chatServerRequest = isChatServerProxyPath(requestUrl.pathname);
      if (chatServerRequest) {
        const port = supervisor?.info().port ?? supervisorPort() ?? 14317;
        const headers = new Headers(request.headers);
        headers.delete("origin");
        for (const name of [...headers.keys()]) {
          if (name.startsWith("sec-fetch-")) headers.delete(name);
        }
        return await net.fetch(chatServerProxyUrl(request.url, port), {
          method: request.method,
          headers,
          ...(request.method === "GET" || request.method === "HEAD"
            ? {}
            : { body: request.body }),
        });
      }
      return await net.fetch(rendererFileUrl(resolveRendererFile(root, request.url)));
    } catch (error) {
      if (chatServerRequest) {
        console.error("Chat Server proxy request failed", request.url, error);
        return Response.json({ error: "Chat Server 代理请求失败" }, { status: 502 });
      }
      return new Response("Not found", { status: 404 });
    }
  });
}

function setupAssetProtocol() {
  const allowedRoots = [app.getPath("home"), app.getPath("downloads"), app.getPath("documents")];
  protocol.handle("chatdesk-asset", (request) => {
    const path = validateAssetPath(new URL(request.url).searchParams.get("path"), allowedRoots);
    const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    const contentType =
      extension === "png"
        ? "image/png"
        : extension === "jpg" || extension === "jpeg"
          ? "image/jpeg"
          : extension === "webp"
            ? "image/webp"
            : extension === "gif"
              ? "image/gif"
              : "application/octet-stream";
    return new Response(readFileSync(path), { headers: { "content-type": contentType } });
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    showMainWindow();
  });
  void app.whenReady().then(() => {
    setupRendererProtocol();
    setupAssetProtocol();
    setupIpc();
    app.on("activate", () => {
      if (!mainWindow || mainWindow.isDestroyed()) createWindow();
      else showMainWindow();
    });
    const iconPath = applicationIconPath();
    if (process.platform === "darwin" && iconPath) app.dock?.setIcon(iconPath);
    ensureTray();
    void setupSupervisor().catch((error) => {
      console.error("Chat Server startup failed", error);
    });
    createWindow();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    if (windowStateSaveTimer) clearTimeout(windowStateSaveTimer);
    windowStateSaveTimer = undefined;
    saveWindowState();
    terminalManager.shutdown();
    void (supervisor?.stop() ?? Promise.resolve()).finally(() => app.exit(0));
  });
  app.on("window-all-closed", () => undefined);
}
