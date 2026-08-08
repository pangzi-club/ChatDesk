import { serve } from "@hono/node-server";
import { createChatServer } from "./app.ts";
import { loadServerConfig } from "./config.ts";

type Shutdown = () => Promise<void> | void;

let shutdownServer: Shutdown | undefined;
let fatalErrorHandled = false;

function errorText(value: unknown) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function installProductionProcessErrorHandlers() {
  if (process.env.CHAT_SERVER_PRODUCTION !== "1") return;

  const handleFatalError = (kind: string, reason: unknown) => {
    console.error(`[Chat Server] ${kind}: ${errorText(reason)}`);
    if (fatalErrorHandled) return;
    fatalErrorHandled = true;

    const forceExit = setTimeout(() => {
      console.error("[Chat Server] 致命错误清理超时，强制退出");
      process.exit(1);
    }, 5_000);
    forceExit.unref();

    void Promise.resolve()
      .then(() => shutdownServer?.())
      .catch((error) => console.error(`[Chat Server] 致命错误清理失败: ${errorText(error)}`))
      .finally(() => {
        clearTimeout(forceExit);
        process.exit(1);
      });
  };

  process.on("uncaughtException", (error) => handleFatalError("未捕获异常", error));
  process.on("unhandledRejection", (reason) => handleFatalError("未处理的 Promise rejection", reason));
}

installProductionProcessErrorHandlers();

async function main() {
  const config = await loadServerConfig();
  const server = await createChatServer(config);
  const httpServer = serve(
    { fetch: server.app.fetch, hostname: config.host, port: config.port },
    (info) => console.log(`Chat server listening on http://${info.address}:${info.port}`),
  );

  let shuttingDown = false;
  async function shutdown() {
    if (shuttingDown) return;
    shuttingDown = true;
    if (process.env.CHAT_SERVER_PRODUCTION === "1") await server.shutdown();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    }).catch((error) => {
      if ((error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") throw error;
    });
  }

  shutdownServer = shutdown;
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
