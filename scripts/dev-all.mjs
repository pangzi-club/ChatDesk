import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";

const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const token = process.env.CHAT_SERVER_TOKEN || randomUUID();
const sharedEnv = {
  ...process.env,
  CHAT_SERVER_TOKEN: token,
  VITE_CHAT_SERVER_TOKEN: token,
};

const children = [
  spawn(pnpm, ["server:dev"], { env: sharedEnv, stdio: "inherit" }),
  spawn(pnpm, ["dev"], { env: sharedEnv, stdio: "inherit" }),
];

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}

for (const child of children) {
  child.once("exit", (code, signal) => {
    if (!shuttingDown) shutdown(code ?? (signal ? 1 : 0));
  });
  child.once("error", () => shutdown(1));
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
