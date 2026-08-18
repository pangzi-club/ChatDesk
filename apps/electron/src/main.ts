import { ChatServerSupervisor } from "@chatdesk/desktop-host";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  shell,
  Tray,
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
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  IPC_CHANNEL,
  IPC_EVENT_PREFIX,
  validateAssetPath,
  validateExternalUrl,
  validateUserStoreFile,
} from "./ipc-contract.js";
import { performHttpRequest } from "./http-bridge.js";
import { TerminalManager } from "./terminal-manager.js";

type DesktopUserStoreFile = "settings.json" | "bookmarks.json";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "chatdesk-asset",
    privileges: { secure: true, standard: true, supportFetchAPI: true },
  },
]);

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let supervisor: ChatServerSupervisor | null = null;
let quitting = false;
const terminalManager = new TerminalManager((id, event) => emit(`terminal:${id}`, event));

function userDataDirectory() {
  return join(app.getPath("home"), ".chatdesk");
}

function userStorePath(fileName: DesktopUserStoreFile) {
  return join(userDataDirectory(), fileName);
}

function rendererEntry() {
  if (process.env.CHATDESK_RENDERER_URL) return process.env.CHATDESK_RENDERER_URL;
  const candidates = [
    join(process.resourcesPath, "desktop/dist/index.html"),
    join(app.getAppPath(), "apps/desktop/dist/index.html"),
    join(app.getAppPath(), "desktop/dist/index.html"),
    join(moduleDirectory, "../../desktop/dist/index.html"),
  ];
  const entry = candidates.find((candidate) => existsSync(candidate));
  if (!entry) throw new Error("找不到 Electron renderer 构建产物");
  return pathToFileURL(entry).toString();
}

function createWindow() {
  const entry = rendererEntry();
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    title: "ChatDesk",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(moduleDirectory, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    try {
      void shell.openExternal(validateExternalUrl(url));
    } catch {
      // Invalid protocols are denied below.
    }
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (url !== entry) event.preventDefault();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  void mainWindow.loadURL(entry);
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
  const runtimeRoot = dirname(dirname(worker));
  const browserWorker = join(runtimeRoot, "workers/browser-worker.mjs");
  const sandboxWorker = join(runtimeRoot, "workers/chat-server-sandbox.cjs");
  const playwrightBrowsers = join(process.resourcesPath, "playwright-browsers");
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

async function setupSupervisor() {
  const worker = resolveChatServerWorker();
  const nodeRuntime = resolveNodeRuntime(worker);
  const usingElectronRuntime = nodeRuntime === process.execPath;
  supervisor = new ChatServerSupervisor({
    command: nodeRuntime,
    args: [worker],
    cwd: dirname(worker),
    dataDir: join(userDataDirectory(), "chat-server"),
    env: chatServerRuntimeEnvironment(worker, usingElectronRuntime),
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

function setTrayEnabled(enabled: boolean) {
  if (!enabled) {
    tray?.destroy();
    tray = null;
    return;
  }
  if (tray) return;
  const iconCandidates = [
    join(process.resourcesPath, "icons/32x32.png"),
    join(app.getAppPath(), "apps/desktop/src-tauri/icons/32x32.png"),
  ];
  const iconPath = iconCandidates.find((candidate) => existsSync(candidate));
  tray = new Tray(iconPath ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty());
  tray.setToolTip("ChatDesk");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "Chat",
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
          emit("tray-chat", null);
        },
      },
      { label: "退出", click: () => app.quit() },
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
      case "set_tray_enabled":
        if (typeof args.enabled !== "boolean") throw new Error("托盘开关参数无效");
        setTrayEnabled(args.enabled);
        return undefined;
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
    mainWindow?.show();
    mainWindow?.focus();
  });
  void app.whenReady().then(async () => {
    setupAssetProtocol();
    setupIpc();
    setTrayEnabled(true);
    await setupSupervisor().catch((error) => {
      console.error("Chat Server startup failed", error);
    });
    createWindow();
  });
  app.on("before-quit", (event) => {
    if (quitting) return;
    quitting = true;
    event.preventDefault();
    terminalManager.shutdown();
    void (supervisor?.stop() ?? Promise.resolve()).finally(() => app.exit(0));
  });
  app.on("window-all-closed", () => undefined);
}
