import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const rendererUrl = process.env.CHATDESK_RENDERER_URL || "http://localhost:1420";
const workerCandidates = [
  process.env.CHATDESK_CHAT_SERVER_WORKER,
  path.join(root, "apps/desktop/src-tauri/resources/node-runtime/workers/chat-server.cjs"),
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

const renderer = start(pnpm, ["dev:web"]);
try {
  await waitForRenderer(rendererUrl, renderer);
} catch (error) {
  shutdown(1);
  throw error;
}

const electron = start(
  pnpm,
  ["--filter", "chatdesk-electron", "exec", "electron", "dist/main.js"],
  {
    ...process.env,
    CHATDESK_RENDERER_URL: rendererUrl,
    CHATDESK_CHAT_SERVER_WORKER: worker,
  },
);

electron.once("exit", (code, signal) => {
  if (shuttingDown) return;
  shutdown(code ?? (signal ? 1 : 0));
});
renderer.once("exit", (code, signal) => {
  if (shuttingDown) return;
  shutdown(code ?? (signal ? 1 : 0));
});

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));

function start(command, args, env = process.env) {
  const child = spawn(command, args, { cwd: root, env, stdio: "inherit" });
  children.add(child);
  child.once("error", (error) => {
    console.error(error.message);
    shutdown(1);
  });
  child.once("exit", () => children.delete(child));
  return child;
}

async function waitForRenderer(url, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Renderer dev server 启动失败");
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`等待 Renderer 超时：${url}`);
}

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  exitCode = code;
  for (const child of children) child.kill("SIGINT");
  setTimeout(() => process.exit(exitCode), 500);
}
