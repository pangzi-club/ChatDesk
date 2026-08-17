import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

type BrowserResponse = {
  ok: boolean;
  sessionId?: string;
  data?: unknown;
  code?: string;
  message?: string;
};

const SOURCE_WORKER_FROM_SRC = "../../desktop/src-tauri/src/sidecar/browser-worker.mjs";
const SOURCE_BROWSERS_FROM_SRC = "../../desktop/src-tauri/resources/playwright-browsers";
const SOURCE_WORKER_FROM_REPO = "apps/desktop/src-tauri/src/sidecar/browser-worker.mjs";
const SOURCE_BROWSERS_FROM_REPO = "apps/desktop/src-tauri/resources/playwright-browsers";
const SOURCE_WORKER_FROM_SERVER = "../desktop/src-tauri/src/sidecar/browser-worker.mjs";
const SOURCE_BROWSERS_FROM_SERVER = "../desktop/src-tauri/resources/playwright-browsers";

function chatServerSourceDir(): string | undefined {
  // Development (`pnpm server:dev`, vitest) runs this file as ESM, so
  // import.meta.url is the real module path under apps/server/src.
  // The packaged sidecar is esbuild --format=cjs: import.meta becomes {} and
  // .url is undefined. Do not call fileURLToPath at module top-level — that
  // throws on load and blocks Tauri's CHAT_SERVER_* env resolution.
  try {
    const url = import.meta.url;
    if (typeof url === "string" && url.length > 0) {
      return path.dirname(fileURLToPath(url));
    }
  } catch {
    // Empty import.meta in the CJS sidecar bundle.
  }
  return undefined;
}

function sourceLayoutPaths(kind: "worker" | "browsers"): string[] {
  const fromSrc = kind === "worker" ? SOURCE_WORKER_FROM_SRC : SOURCE_BROWSERS_FROM_SRC;
  const fromRepo = kind === "worker" ? SOURCE_WORKER_FROM_REPO : SOURCE_BROWSERS_FROM_REPO;
  const fromServer = kind === "worker" ? SOURCE_WORKER_FROM_SERVER : SOURCE_BROWSERS_FROM_SERVER;
  const paths: string[] = [];
  const sourceDir = chatServerSourceDir();
  // ESM source: this file lives in apps/server/src.
  if (sourceDir) paths.push(path.resolve(sourceDir, fromSrc));
  // `pnpm server:dev` / tests from the workspace root.
  paths.push(path.resolve(process.cwd(), fromRepo));
  // Tests or a manual run whose cwd is apps/server.
  paths.push(path.resolve(process.cwd(), fromServer));
  return [...new Set(paths)];
}

export function resolveBrowserWorkerScript(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
) {
  // Packaged apps: Tauri injects CHAT_SERVER_BROWSER_WORKER. That is the only
  // reliable locator in the CJS sidecar because import.meta.url is empty.
  const configured = env.CHAT_SERVER_BROWSER_WORKER || env.M_DASHBOARD_BROWSER_WORKER;
  if (configured) return configured;
  return sourceLayoutPaths("worker").find(exists);
}

export function resolvePlaywrightBrowsersPath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
  listDir: (dir: string) => string[] = (dir) => readdirSync(dir),
) {
  if (env.CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH) return env.CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH;
  for (const browsers of sourceLayoutPaths("browsers")) {
    if (!exists(browsers)) continue;
    try {
      // Debug builds write a placeholder.txt here; ignore that and use Playwright's
      // default cache unless a real Chromium download is present.
      if (listDir(browsers).some((name) => name.startsWith("chromium"))) {
        return browsers;
      }
    } catch {}
  }
  return undefined;
}

export class BrowserRuntime {
  private worker?: ChildProcessWithoutNullStreams;
  private pending = new Map<string, (value: BrowserResponse) => void>();

  async request(method: string, params: Record<string, unknown>) {
    this.ensureWorker();
    const id = randomUUID();
    const result = new Promise<BrowserResponse>((resolve) => this.pending.set(id, resolve));
    try {
      this.worker?.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    } catch (error) {
      this.pending.delete(id);
      this.close();
      return {
        ok: false,
        code: "worker_error",
        message: error instanceof Error ? error.message : String(error),
      };
    }
    return result;
  }

  close() {
    this.worker?.kill();
    this.worker = undefined;
    for (const resolve of this.pending.values())
      resolve({ ok: false, code: "closed", message: "浏览器 worker 已关闭" });
    this.pending.clear();
  }

  private ensureWorker() {
    if (this.worker) return;
    const script = resolveBrowserWorkerScript();
    if (!script) {
      throw new Error(
        "未配置 browser worker。开发环境请从仓库根目录运行 pnpm dev，或设置 CHAT_SERVER_BROWSER_WORKER。",
      );
    }
    const browsersPath = resolvePlaywrightBrowsersPath();
    const command = script.endsWith(".js") || script.endsWith(".mjs") ? "node" : script;
    const args = command === "node" ? [script] : [];
    const worker = spawn(command, args, {
      env: {
        ...process.env,
        ...(browsersPath ? { PLAYWRIGHT_BROWSERS_PATH: browsersPath } : {}),
      },
      stdio: "pipe",
    });
    const lines = createInterface({ input: worker.stdout });
    worker.stderr.on("data", (chunk) => {
      console.error(`[Chat Server] browser worker stderr: ${String(chunk).trimEnd()}`);
    });
    lines.on("line", (line) => {
      try {
        const value = JSON.parse(line) as BrowserResponse & { id?: string };
        if (!value.id) return;
        const resolve = this.pending.get(value.id);
        if (!resolve) return;
        this.pending.delete(value.id);
        resolve(value);
      } catch {
        // Ignore worker diagnostics.
      }
    });
    worker.once("exit", () => {
      if (this.worker === worker) this.close();
    });
    worker.once("error", (error) => {
      console.error(`[Chat Server] browser worker 进程错误: ${error.message}`);
      if (this.worker === worker) this.close();
    });
    worker.stdin.on("error", (error) => {
      console.error(`[Chat Server] browser worker stdin 错误: ${error.message}`);
      if (this.worker === worker) this.close();
    });
    this.worker = worker;
  }
}
