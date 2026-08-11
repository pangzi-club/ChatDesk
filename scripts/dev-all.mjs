import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const token = process.env.CHAT_SERVER_TOKEN || randomUUID();
const port = process.env.CHAT_SERVER_PORT || "14317";
const sharedEnv = {
  ...process.env,
  CHAT_SERVER_TOKEN: token,
  CHAT_SERVER_PORT: port,
  VITE_CHAT_SERVER_TOKEN: token,
  VITE_CHAT_SERVER_PORT: port,
};

const children = [
  spawn(pnpm, ["server:dev"], { env: sharedEnv, stdio: "inherit" }),
  spawn(pnpm, ["--filter", "chatdesk-desktop", "exec", "tauri", "dev"], {
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
