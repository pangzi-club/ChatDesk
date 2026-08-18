import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const rendererUrl = process.env.CHATDESK_RENDERER_URL || "http://localhost:1420";
const port = process.env.CHAT_SERVER_PORT || "14317";
const token =
  process.env.CHATDESK_CHAT_SERVER_TOKEN || process.env.CHAT_SERVER_TOKEN || randomUUID();
const workerCandidates = [
  process.env.CHATDESK_CHAT_SERVER_WORKER,
  path.join(root, "apps/desktop/assets/resources/node-runtime/workers/chat-server.cjs"),
  path.join(root, "apps/server/.cache/chat-server.cjs"),
].filter(Boolean);

const worker = workerCandidates.find((candidate) => existsSync(candidate));
if (!worker) {
  console.error("找不到 Chat Server worker。首次运行前请执行：pnpm desktop:sidecars");
  process.exit(1);
}

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
  start(resolveElectronBinary(), [path.join(root, "apps/electron")], {
    cwd: path.join(root, "apps/electron"),
    env: {
      ...sharedEnv,
      CHATDESK_RENDERER_URL: rendererUrl,
      CHATDESK_CHAT_SERVER_WORKER: worker,
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
