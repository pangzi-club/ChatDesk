import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";

type BrowserResponse = {
  ok: boolean;
  sessionId?: string;
  data?: unknown;
  code?: string;
  message?: string;
};

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
    const script = process.env.CHAT_SERVER_BROWSER_WORKER || process.env.M_DASHBOARD_BROWSER_WORKER;
    if (!script) throw new Error("未配置 browser worker");
    const command = script.endsWith(".js") || script.endsWith(".mjs") ? "node" : script;
    const args = command === "node" ? [script] : [];
    const worker = spawn(command, args, {
      env: {
        ...process.env,
        ...(process.env.CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH
          ? { PLAYWRIGHT_BROWSERS_PATH: process.env.CHAT_SERVER_PLAYWRIGHT_BROWSERS_PATH }
          : {}),
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
