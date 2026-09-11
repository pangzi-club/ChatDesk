import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { normalizeChatServerPort } from "@chatdesk/shared";

export type ServerConfig = {
  host: string;
  port: number;
  dataDir: string;
  token: string;
  version: string;
};

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
    port: normalizeChatServerPort(process.env.CHAT_SERVER_PORT ?? persisted.port),
    dataDir,
    token: process.env.CHAT_SERVER_TOKEN || randomUUID(),
    version: "0.4.0",
  };
}

export async function savePendingPort(dataDir: string, port: number) {
  await writeFile(path.join(dataDir, "server-config.json"), JSON.stringify({ port }, null, 2));
}
