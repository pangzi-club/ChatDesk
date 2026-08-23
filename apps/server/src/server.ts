import { acquireDataDirectoryLock, installAiSdkWarningFilter } from "@chatdesk/agent-core";

installAiSdkWarningFilter();

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
  process.on("unhandledRejection", (reason) =>
    handleFatalError("未处理的 Promise rejection", reason),
  );
}

installProductionProcessErrorHandlers();

async function main() {
  const [{ serve }, { createChatServer }, { loadServerConfig }, { resolveBrowserWorkerScript }] =
    await Promise.all([
      import("@hono/node-server"),
      import("./app.ts"),
      import("./config.ts"),
      import("@chatdesk/agent-core"),
    ]);
  const config = await loadServerConfig();
  const browserWorker = resolveBrowserWorkerScript();
  if (browserWorker) console.log(`[Chat Server] browser worker: ${browserWorker}`);
  else console.warn("[Chat Server] 未配置 browser worker，浏览器工具将不可用");
  const dataDirectoryLock = await acquireDataDirectoryLock(config.dataDir);
  let server: Awaited<ReturnType<typeof createChatServer>>;
  try {
    server = await createChatServer(config);
  } catch (error) {
    await dataDirectoryLock.release();
    throw error;
  }
  let httpServer: ReturnType<typeof serve>;
  try {
    httpServer = serve(
      { fetch: server.app.fetch, hostname: config.host, port: config.port },
      (info) => console.log(`Chat server listening on http://${info.address}:${info.port}`),
    );
  } catch (error) {
    await server.shutdown();
    await dataDirectoryLock.release();
    throw error;
  }

  let shuttingDown = false;
  async function shutdown(exitCode?: number) {
    if (shuttingDown) return;
    shuttingDown = true;
    const isProduction = process.env.CHAT_SERVER_PRODUCTION === "1";
    // node --watch sends SIGTERM and waits until this process exits. Desktop SSE
    // keep-alive connections otherwise make httpServer.close() hang forever, so
    // the watcher stays on "Waiting for graceful termination..." and /health dies.
    const forceExit =
      exitCode === undefined
        ? undefined
        : setTimeout(() => process.exit(exitCode), isProduction ? 5_000 : 1_500);

    try {
      if (isProduction) await server.shutdown();
    } catch (error) {
      console.error(`[Chat Server] 关闭失败: ${errorText(error)}`);
    }

    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => {
        if (error && (error as NodeJS.ErrnoException).code !== "ERR_SERVER_NOT_RUNNING") {
          reject(error);
          return;
        }
        resolve();
      });
      if (
        "closeAllConnections" in httpServer &&
        typeof httpServer.closeAllConnections === "function"
      ) {
        httpServer.closeAllConnections();
      }
    }).catch((error) => {
      console.error(`[Chat Server] 关闭 HTTP 服务失败: ${errorText(error)}`);
    });

    await dataDirectoryLock.release();

    if (forceExit) clearTimeout(forceExit);
    if (exitCode !== undefined) process.exit(exitCode);
  }

  shutdownServer = shutdown;
  process.once("SIGINT", () => void shutdown(0));
  process.once("SIGTERM", () => void shutdown(0));
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
