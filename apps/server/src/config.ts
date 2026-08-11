import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export type ServerConfig = {
  host: string;
  port: number;
  dataDir: string;
  token: string;
  version: string;
};

const DEFAULT_PORT = 14317;

function parsePort(value: string | undefined) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : DEFAULT_PORT;
}

export async function loadServerConfig(): Promise<ServerConfig> {
  const defaultDataDir =
    process.platform === "darwin"
      ? path.join(os.homedir(), ".chatdesk", "chat-server")
      : path.join(".data", "chat-server");
  const dataDir = path.resolve(process.env.CHAT_SERVER_DATA_DIR || defaultDataDir);
  await mkdir(dataDir, { recursive: true });
  const persisted: { port?: unknown } = await readFile(
    path.join(dataDir, "server-config.json"),
    "utf8",
  )
    .then((value) => JSON.parse(value) as { port?: unknown })
    .catch(() => ({}));
  return {
    host: process.env.CHAT_SERVER_HOST || "127.0.0.1",
    port: parsePort(process.env.CHAT_SERVER_PORT || String(persisted.port ?? DEFAULT_PORT)),
    dataDir,
    token: process.env.CHAT_SERVER_TOKEN || randomUUID(),
    version: "0.2.0",
  };
}

export async function savePendingPort(dataDir: string, port: number) {
  await writeFile(path.join(dataDir, "server-config.json"), JSON.stringify({ port }, null, 2));
}
