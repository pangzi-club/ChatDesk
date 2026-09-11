import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveCuaDriver } from "./cua-driver.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const rendererUrl = process.env.CHATDESK_RENDERER_URL || "http://127.0.0.1:1420";
const port = process.env.CHAT_SERVER_PORT || "14317";
const token =
  process.env.CHATDESK_CHAT_SERVER_TOKEN || process.env.CHAT_SERVER_TOKEN || randomUUID();
const configuredWorker = process.env.CHATDESK_CHAT_SERVER_WORKER;
const worker = configuredWorker || path.join(root, "apps/server/src/server.ts");
const runtimeRoot =
  process.env.CHATDESK_CHAT_SERVER_RUNTIME_ROOT ||
  (configuredWorker ? "" : path.join(root, "apps/desktop/assets/resources/node-runtime"));
const playwrightBrowsers =
  process.env.CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH ||
  path.join(root, "apps/desktop/assets/resources/playwright-browsers");
if (!existsSync(worker)) {
  console.error(`找不到 Chat Server 入口：${worker}`);
  process.exit(1);
}
if (runtimeRoot && !existsSync(runtimeRoot)) {
  console.error("找不到 Chat Server runtime。首次运行前请执行：pnpm desktop:sidecars");
  process.exit(1);
}

// Resolve the Cua Driver in parallel with the Electron build and Vite startup.
const cuaDriverPromise = resolveDevelopmentCuaDriver();

const build = spawnSync(pnpm, ["electron:build"], {
  cwd: root,
  env: process.env,
  stdio: "inherit",
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status ?? 1);

const children = new Set();
let shuttingDown = false;
let exitCode = 0;
const sharedEnv = {
  ...process.env,
  CHAT_SERVER_PORT: port,
  CHAT_SERVER_TOKEN: token,
  CHATDESK_CHAT_SERVER_TOKEN: token,
  VITE_CHAT_SERVER_PORT: port,
  VITE_CHAT_SERVER_TOKEN: token,
};

const renderer = start(process.execPath, [resolveViteCli()], {
  cwd: path.join(root, "apps/desktop"),
  env: sharedEnv,
});
try {
  await waitForRenderer(rendererUrl, renderer);
} catch (error) {
  if (!shuttingDown) {
    console.error(error instanceof Error ? error.message : error);
    shutdown(1);
  }
}

if (!shuttingDown) {
  const cuaDriver = await cuaDriverPromise;
  start(resolveElectronBinary(), [path.join(root, "apps/electron")], {
    cwd: path.join(root, "apps/electron"),
    env: {
      ...sharedEnv,
      CHATDESK_RENDERER_URL: rendererUrl,
      CHATDESK_CHAT_SERVER_WORKER: worker,
      CHATDESK_NODE_RUNTIME: process.env.CHATDESK_NODE_RUNTIME || process.execPath,
      ...(runtimeRoot ? { CHATDESK_CHAT_SERVER_RUNTIME_ROOT: runtimeRoot } : {}),
      ...(configuredWorker ? {} : { CHATDESK_CHAT_SERVER_WATCH: "1" }),
      ...(cuaDriver ? { CHATDESK_CUA_DRIVER: cuaDriver } : {}),
      ...(existsSync(playwrightBrowsers)
        ? { CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsers }
        : {}),
    },
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
process.on("SIGHUP", () => shutdown(0));

function resolveViteCli() {
  const candidates = [
    path.join(root, "apps/desktop/node_modules/vite/bin/vite.js"),
    path.join(root, "node_modules/vite/bin/vite.js"),
  ];
  const cli = candidates.find((candidate) => existsSync(candidate));
  if (!cli) throw new Error("找不到 Vite");
  return cli;
}

function resolveElectronBinary() {
  const require = createRequire(path.join(root, "apps/electron/package.json"));
  const binary = require("electron");
  if (typeof binary !== "string" || !existsSync(binary)) {
    throw new Error("找不到 Electron 可执行文件");
  }
  return binary;
}

/**
 * Development never fails on a missing driver: Computer Use simply stays
 * unavailable. A local Cua Driver installation is used as-is; otherwise the
 * pinned release is downloaded once into the staged assets directory. Set
 * CHATDESK_CUA_DRIVER_FETCH=0 to skip that download.
 */
async function resolveDevelopmentCuaDriver() {
  const download = process.platform === "darwin" && process.env.CHATDESK_CUA_DRIVER_FETCH !== "0";
  try {
    const driver = await resolveCuaDriver({ download });
    if (driver) {
      console.log(`Cua Driver：${driver}`);
      return driver;
    }
  } catch (error) {
    console.warn(`准备 Cua Driver 失败：${error instanceof Error ? error.message : error}`);
  }
  console.warn(
    "未找到 cua-driver，开发环境中的 Computer Use 将不可用。安装：/bin/bash -c " +
      '"$(curl -fsSL https://cua.ai/driver/install.sh)"，或设置 CHATDESK_CUA_DRIVER。',
  );
  return null;
}

function start(command, args, options) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    stdio: "inherit",
    ...(process.platform === "win32" ? {} : { detached: true }),
  });
  children.add(child);
  child.once("error", (error) => {
    if (shuttingDown) return;
    console.error(error.message);
    shutdown(1);
  });
  child.once("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    shutdown(signal === "SIGINT" || signal === "SIGTERM" ? 0 : (code ?? 1));
  });
  return child;
}

function stopChild(child) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // already exited
    }
  }
}

async function waitForRenderer(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (shuttingDown) return;
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("Renderer dev server 启动失败");
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  if (!shuttingDown) throw new Error(`等待 Renderer 超时：${url}`);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  const remaining = [...children];
  if (remaining.length === 0) {
    process.exit(exitCode);
    return;
  }
  for (const child of remaining) stopChild(child);
  const finish = () => process.exit(exitCode);
  const timeout = setTimeout(() => {
    for (const child of remaining) {
      if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue;
      try {
        if (process.platform === "win32") stopChild(child);
        else process.kill(-child.pid, "SIGKILL");
      } catch {
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
      }
    }
    finish();
  }, 1500);
  const maybeFinish = () => {
    if (children.size === 0) {
      clearTimeout(timeout);
      finish();
    }
  };
  for (const child of remaining) child.once("exit", maybeFinish);
  maybeFinish();
}
