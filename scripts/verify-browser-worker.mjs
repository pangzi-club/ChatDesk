import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resourcesDir = path.join(root, "apps/desktop/src-tauri/resources");
const browserPath = path.join(resourcesDir, "playwright-browsers");
const executable = path.join(
  resourcesDir,
  process.platform === "win32" ? "browser-worker.exe" : "browser-worker",
);

if (!existsSync(executable)) {
  throw new Error(`Packaged browser worker does not exist: ${executable}`);
}

await verifyBrowserWorker();

async function verifyBrowserWorker() {
  const page =
    '<!doctype html><html><head><meta charset="utf-8"></head><body data-chatdesk-browser-worker-smoke="ready">ready</body></html>';
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-length": Buffer.byteLength(page),
      "content-type": "text/html; charset=utf-8",
    });
    response.end(page);
  });
  let worker;
  let lines;
  let stderr = "";

  try {
    const address = await listen(server);
    worker = spawn(executable, [], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browserPath },
      stdio: "pipe",
    });
    lines = createInterface({ input: worker.stdout });
    worker.stderr.on("data", (chunk) => {
      stderr += chunk;
    });

    const expectedUrl = `http://127.0.0.1:${address.port}/`;
    const sessionId = "browser-worker-build-smoke";
    const opened = await requestBrowserWorker(worker, lines, {
      id: "browser-worker-open",
      method: "open",
      params: { sessionId, timeoutMs: 15_000, url: expectedUrl },
    });
    if (!opened.ok || opened.sessionId !== sessionId || opened.data?.url !== expectedUrl) {
      throw new Error(`browser_open failed: ${JSON.stringify(opened)}`);
    }

    const evaluated = await requestBrowserWorker(worker, lines, {
      id: "browser-worker-eval",
      method: "eval",
      params: {
        expression: "document.body?.dataset.chatdeskBrowserWorkerSmoke",
        sessionId,
      },
    });
    if (!evaluated.ok || evaluated.data?.value !== "ready") {
      throw new Error(`browser_open page verification failed: ${JSON.stringify(evaluated)}`);
    }

    const closed = await requestBrowserWorker(worker, lines, {
      id: "browser-worker-close",
      method: "close",
      params: { sessionId },
    });
    if (!closed.ok) throw new Error(`browser_close failed: ${JSON.stringify(closed)}`);
    console.log("Verified packaged browser worker browser_open");
  } catch (error) {
    const detail = stderr.trim();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Packaged browser worker smoke test failed: ${message}${detail ? `\n${detail}` : ""}`,
    );
  } finally {
    lines?.close();
    worker?.kill();
    await closeServer(server);
  }
}

function listen(server) {
  return new Promise((resolve, reject) => {
    const onError = (error) => reject(error);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve browser worker smoke test address"));
        return;
      }
      resolve(address);
    });
  });
}

function requestBrowserWorker(worker, lines, request) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${request.method}`));
    }, 30_000);
    const onExit = (code, signal) => {
      cleanup();
      reject(
        new Error(`Browser worker exited during ${request.method}: code=${code} signal=${signal}`),
      );
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onLine = (line) => {
      let response;
      try {
        response = JSON.parse(line);
      } catch {
        return;
      }
      if (response.id !== request.id) return;
      cleanup();
      resolve(response);
    };
    const cleanup = () => {
      clearTimeout(timer);
      lines.off("line", onLine);
      worker.off("exit", onExit);
      worker.off("error", onError);
    };

    lines.on("line", onLine);
    worker.once("exit", onExit);
    worker.once("error", onError);
    worker.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
      if (!error) return;
      cleanup();
      reject(error);
    });
  });
}

function closeServer(server) {
  if (!server.listening) return Promise.resolve();
  return new Promise((resolve) => server.close(resolve));
}
