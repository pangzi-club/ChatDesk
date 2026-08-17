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

// `pnpm dev` / `pnpm server:dev` run the TypeScript Chat Server from source.
// Packaged apps inject CHAT_SERVER_BROWSER_WORKER; development falls back to
// the sidecar script checked into the repo.
const SOURCE_BROWSER_WORKER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../desktop/src-tauri/src/sidecar/browser-worker.mjs",
);
const SOURCE_PLAYWRIGHT_BROWSERS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../desktop/src-tauri/resources/playwright-browsers",
);

export function resolveBrowserWorkerScript(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
) {
  const configured = env.CHAT_SERVER_BROWSER_WORKER || env.M_DASHBOARD_BROWSER_WORKER;
  if (configured) return configured;
  if (exists(SOURCE_BROWSER_WORKER)) return SOURCE_BROWSER_WORKER;
  return undefined;
}

export function resolvePlaywrightBrowsersPath(
  env: NodeJS.ProcessEnv = process.env,
  exists: (file: string) => boolean = existsSync,
  listDir: (dir: string) => string[] = (dir) => readdirSync(dir),
) {
  if (env.CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH) return env.CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH;
  if (!exists(SOURCE_PLAYWRIGHT_BROWSERS)) return undefined;
  try {
    // Debug builds write a placeholder.txt here; ignore that and use Playwright's
    // default cache unless a real Chromium download is present.
    if (listDir(SOURCE_PLAYWRIGHT_BROWSERS).some((name) => name.startsWith("chromium"))) {
      return SOURCE_PLAYWRIGHT_BROWSERS;
    }
  } catch {
    return undefined;
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
