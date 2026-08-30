import { spawn as spawnProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { EventEmitter } from "node:events";

export type ChatServerHostState = "running" | "starting" | "restarting" | "offline";

export type ChatServerHostInfo = {
  host: string;
  port: number;
  token: string;
  managed: boolean;
  running: boolean;
  state: ChatServerHostState;
  restartAttempt: number;
  lastExit: string | null;
};

type HostProcess = Pick<EventEmitter, "once"> & {
  kill(signal?: NodeJS.Signals): boolean;
  stdout?: Pick<EventEmitter, "on">;
  stderr?: Pick<EventEmitter, "on">;
};

type SpawnProcess = (
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; stdio: ["ignore", "pipe", "pipe"] },
) => HostProcess;

export type ChatServerSupervisorOptions = {
  command: string;
  args?: string[];
  cwd?: string;
  dataDir?: string;
  host?: string;
  port?: number;
  token?: string;
  production?: boolean;
  maxRestartAttempts?: number;
  stableRuntimeMs?: number;
  startupTimeoutMs?: number;
  monitorIntervalMs?: number;
  restartDelayMs?: number;
  onOutput?: (stream: "stdout" | "stderr", text: string) => void;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  spawnImpl?: SpawnProcess;
};

type StateListener = (info: ChatServerHostInfo) => void;

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 14317;

export class ChatServerSupervisor {
  private child: HostProcess | null = null;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stopRequested = false;
  private lifecycle = Promise.resolve();
  private readonly listeners = new Set<StateListener>();
  private current: ChatServerHostInfo;
  private startedAt = 0;

  constructor(private readonly options: ChatServerSupervisorOptions) {
    this.current = {
      host: options.host ?? DEFAULT_HOST,
      port: options.port ?? DEFAULT_PORT,
      token: options.token ?? randomUUID(),
      managed: true,
      running: false,
      state: "offline",
      restartAttempt: 0,
      lastExit: null,
    };
  }

  info(): ChatServerHostInfo {
    return { ...this.current };
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    listener(this.info());
    return () => this.listeners.delete(listener);
  }

  start(): Promise<ChatServerHostInfo> {
    return this.enqueue(() => this.startInternal(0)).then(() => this.info());
  }

  restart(): Promise<ChatServerHostInfo> {
    return this.enqueue(async () => {
      await this.stopInternal();
      this.stopRequested = false;
      await this.startInternal(0);
    }).then(() => this.info());
  }

  stop(): Promise<ChatServerHostInfo> {
    return this.enqueue(() => this.stopInternal()).then(() => this.info());
  }

  private enqueue<T>(action: () => Promise<T>) {
    const task = this.lifecycle.then(action);
    this.lifecycle = task.then(
      () => undefined,
      () => undefined,
    );
    return task;
  }

  private async startInternal(attempt: number) {
    if (this.child) return;
    this.stopRequested = false;
    this.update({
      state: attempt === 0 ? "starting" : "restarting",
      running: false,
      restartAttempt: attempt,
    });

    const host = this.current.host;
    const port = this.current.port;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...this.options.env,
      CHAT_SERVER_HOST: host,
      CHAT_SERVER_PORT: String(port),
      CHAT_SERVER_TOKEN: this.current.token,
      CHAT_SERVER_PRODUCTION: this.options.production === false ? "0" : "1",
      ...(this.options.dataDir ? { CHAT_SERVER_DATA_DIR: this.options.dataDir } : {}),
    };
    const spawn =
      this.options.spawnImpl ??
      ((command, args, spawnOptions) => spawnProcess(command, args, spawnOptions));
    const child = spawn(this.options.command, this.options.args ?? [], {
      cwd: this.options.cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.child = child;
    this.startedAt = Date.now();
    // Always drain child pipes. An unconsumed pipe can fill and block the
    // Chat Server process, which otherwise looks like a random crash.
    child.stdout?.on("data", (data: unknown) => {
      this.options.onOutput?.("stdout", Buffer.from(data as Uint8Array).toString("utf8"));
    });
    child.stderr?.on("data", (data: unknown) => {
      this.options.onOutput?.("stderr", Buffer.from(data as Uint8Array).toString("utf8"));
    });
    child.once("exit", (code: number | null, signal: NodeJS.Signals | null) =>
      this.handleExit(child, code, signal),
    );
    child.once("error", (error: Error) => this.handleError(child, error));

    try {
      await this.waitUntilHealthy(child);
    } catch (error) {
      if (this.child === child) this.child = null;
      child.kill("SIGTERM");
      this.update({ state: "offline", running: false, lastExit: errorText(error) });
      throw error;
    }
    if (this.child !== child || this.stopRequested) return;
    this.update({ state: "running", running: true, lastExit: null });
    this.startMonitor();
  }

  private async stopInternal() {
    this.stopRequested = true;
    this.clearTimers();
    const child = this.child;
    this.child = null;
    if (child) child.kill("SIGTERM");
    this.update({ state: "offline", running: false });
  }

  private async waitUntilHealthy(child: HostProcess) {
    const timeout = this.options.startupTimeoutMs ?? 15_000;
    const deadline = Date.now() + timeout;
    let lastError: unknown = new Error("Chat Server 未就绪");
    while (Date.now() < deadline && this.child === child && !this.stopRequested) {
      try {
        const response = await (this.options.fetchImpl ?? fetch)(
          `http://${this.current.host}:${this.current.port}/v1/sessions`,
          {
            headers: { Authorization: `Bearer ${this.current.token}` },
            signal: AbortSignal.timeout(Math.min(1_500, Math.max(100, deadline - Date.now()))),
          },
        );
        if (response.ok) return;
        lastError = new Error(`Chat Server 返回 HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }
      await delay(100);
    }
    throw lastError;
  }

  private startMonitor() {
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = setInterval(() => {
      if (Date.now() - this.startedAt >= (this.options.stableRuntimeMs ?? 60_000)) {
        if (this.current.restartAttempt !== 0) this.update({ restartAttempt: 0 });
      }
    }, this.options.monitorIntervalMs ?? 5_000);
    this.monitorTimer.unref?.();
  }

  private handleError(child: HostProcess, error: Error) {
    if (this.child === child && !this.stopRequested) {
      this.update({ lastExit: errorText(error), running: false });
    }
  }

  private handleExit(child: HostProcess, code: number | null, signal: NodeJS.Signals | null) {
    if (this.child !== child) return;
    this.child = null;
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.monitorTimer = null;
    const attempt = this.current.restartAttempt + 1;
    this.update({
      running: false,
      state: "offline",
      lastExit: signal ? `signal ${signal}` : `code ${code ?? 0}`,
      restartAttempt: attempt,
    });
    if (this.stopRequested || attempt > (this.options.maxRestartAttempts ?? 3)) return;
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.enqueue(() => this.startInternal(attempt)).catch((error) => {
        this.update({ state: "offline", running: false, lastExit: errorText(error) });
      });
    }, this.options.restartDelayMs ?? 250);
    this.restartTimer.unref?.();
  }

  private clearTimers() {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.monitorTimer) clearInterval(this.monitorTimer);
    this.restartTimer = null;
    this.monitorTimer = null;
  }

  private update(next: Partial<ChatServerHostInfo>) {
    this.current = { ...this.current, ...next };
    for (const listener of this.listeners) listener(this.info());
  }
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function errorText(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
