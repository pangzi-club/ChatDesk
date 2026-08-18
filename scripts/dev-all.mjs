import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const token = process.env.CHAT_SERVER_TOKEN || randomUUID();
const port = process.env.CHAT_SERVER_PORT || "14317";
// Development Chat Server is the TypeScript ESM process, not the Tauri sidecar.
// Point it at the source browser worker so browser_* tools work under `pnpm tauri:dev`
// even before browser-runtime.ts falls back to import.meta.url / repo-relative paths.
const browserWorker =
  process.env.CHAT_SERVER_BROWSER_WORKER ||
  path.join(root, "apps/tauri/src-tauri/src/sidecar/browser-worker.mjs");
const playwrightBrowsers =
  process.env.CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH ||
  packagedPlaywrightBrowsers(path.join(root, "apps/desktop/assets/resources/playwright-browsers"));
const sharedEnv = {
  ...process.env,
  CHAT_SERVER_TOKEN: token,
  CHAT_SERVER_PORT: port,
  VITE_CHAT_SERVER_TOKEN: token,
  VITE_CHAT_SERVER_PORT: port,
  CHAT_SERVER_BROWSER_WORKER: browserWorker,
  ...(playwrightBrowsers ? { CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH: playwrightBrowsers } : {}),
};

const children = [
  spawn(pnpm, ["server:dev"], { env: sharedEnv, stdio: "inherit" }),
  spawn(pnpm, ["--filter", "chatdesk-tauri", "exec", "tauri", "dev"], {
    env: sharedEnv,
    stdio: "inherit",
  }),
];

let shuttingDown = false;
function shutdown(code = 0, signal = "SIGINT") {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill(signal);
  setTimeout(() => process.exit(code), 500);
}

for (const child of children) {
  child.once("exit", (code, signal) => {
    if (!shuttingDown) shutdown(code ?? (signal && signal !== "SIGINT" ? 1 : 0));
  });
  child.once("error", () => shutdown(1));
}

process.once("SIGINT", () => shutdown(0, "SIGINT"));
process.once("SIGTERM", () => shutdown(0, "SIGINT"));

function packagedPlaywrightBrowsers(dir) {
  if (!existsSync(dir)) return undefined;
  try {
    return readdirSync(dir).some((name) => name.startsWith("chromium")) ? dir : undefined;
  } catch {
    return undefined;
  }
}
