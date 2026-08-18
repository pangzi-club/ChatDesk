import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const NODE_RUNTIME_VERSION = "v22.20.0";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const layout = await resolveLayout(process.argv.slice(2));

for (const [name, filename] of Object.entries(layout)) {
  if (!existsSync(filename)) throw new Error(`Packaged ${name} does not exist: ${filename}`);
}

await verifyNodeRuntime();
await verifyRuntimeDependencies();
await verifyBrowserWorker();

async function resolveLayout(args) {
  if (args[0] !== "--app" && args[0] !== "--electron-app") {
    const targetTriple = process.env.DESKTOP_TARGET_TRIPLE || platformTargetTriple();
    const extension = process.platform === "win32" ? ".exe" : "";
    const resourcesDir = path.join(root, "apps/tauri/src-tauri/resources");
    const runtimeRoot = path.join(resourcesDir, "node-runtime");
    return {
      nodeRuntime: path.join(
        root,
        "apps/tauri/src-tauri/binaries",
        `node-runtime-${targetTriple}${extension}`,
      ),
      runtimeRoot,
      worker: path.join(runtimeRoot, "workers/browser-worker.mjs"),
      browsers: path.join(resourcesDir, "playwright-browsers"),
    };
  }

  if (process.platform !== "darwin") {
    throw new Error("Packaged application verification currently supports macOS .app bundles");
  }
  if (args[0] === "--electron-app") {
    const appPath = path.resolve(args[1] || defaultElectronAppPath());
    const resourcesRoot = path.join(appPath, "Contents/Resources");
    const runtimeRoot = path.join(resourcesRoot, "node-runtime");
    return {
      nodeRuntime: path.join(
        resourcesRoot,
        "binaries",
        `node-runtime-${process.env.DESKTOP_TARGET_TRIPLE || platformTargetTriple()}`,
      ),
      runtimeRoot,
      worker: path.join(runtimeRoot, "workers/browser-worker.mjs"),
      browsers: path.join(resourcesRoot, "playwright-browsers"),
    };
  }
  const appPath = path.resolve(args[1] || defaultMacAppPath());
  const runtimeRoot = path.join(appPath, "Contents/Resources/resources/node-runtime");
  return {
    nodeRuntime: path.join(appPath, "Contents/MacOS/node-runtime"),
    runtimeRoot,
    worker: path.join(runtimeRoot, "workers/browser-worker.mjs"),
    browsers: path.join(appPath, "Contents/Resources/resources/playwright-browsers"),
  };
}

function defaultElectronAppPath() {
  const candidates = [
    path.join(root, "apps/electron/dist-electron/mac/ChatDesk.app"),
    path.join(root, "apps/electron/dist-electron/mac-arm64/ChatDesk.app"),
    path.join(root, "apps/electron/dist-electron/mac-x64/ChatDesk.app"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) || candidates[0];
}

function defaultMacAppPath() {
  const targetTriple = process.env.DESKTOP_TARGET_TRIPLE;
  const targetRoot = targetTriple
    ? path.join(root, "apps/tauri/src-tauri/target", targetTriple)
    : path.join(root, "apps/tauri/src-tauri/target");
  return path.join(targetRoot, "release/bundle/macos/ChatDesk.app");
}

async function verifyNodeRuntime() {
  const version = (await execFile(layout.nodeRuntime, ["--version"])).trim();
  if (version !== NODE_RUNTIME_VERSION) {
    throw new Error(`Packaged Node version is ${version}, expected ${NODE_RUNTIME_VERSION}`);
  }
}

async function verifyRuntimeDependencies() {
  await execFile(layout.nodeRuntime, ["-e", 'require("playwright"); require("sharp")'], {
    cwd: layout.runtimeRoot,
  });
}

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
    worker = spawn(layout.nodeRuntime, [layout.worker], {
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: layout.browsers },
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
    console.log(`Verified browser_open with ${layout.nodeRuntime}`);
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

function platformTargetTriple() {
  if (process.platform === "darwin") {
    return process.arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (process.platform === "win32") {
    return process.arch === "arm64" ? "aarch64-pc-windows-msvc" : "x86_64-pc-windows-msvc";
  }
  if (process.platform === "linux") {
    return process.arch === "arm64" ? "aarch64-unknown-linux-gnu" : "x86_64-unknown-linux-gnu";
  }
  throw new Error(`Unsupported desktop target: ${process.platform}/${process.arch}`);
}

function execFile(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd || root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`));
    });
  });
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
