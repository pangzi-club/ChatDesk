import type { IPty } from "node-pty";
import { spawn as spawnPty } from "node-pty";
import { realpathSync, statSync } from "node:fs";

const MIN_TERMINAL_DIMENSION = 2;
const MAX_TERMINAL_DIMENSION = 1_000;
const TERMINAL_ID_PATTERN = /^[a-f0-9-]{36}$/i;

export type TerminalEvent =
  | { type: "output"; data: string }
  | { type: "exit"; code: number; signal?: string }
  | { type: "error"; message: string };

type PtySpawner = typeof spawnPty;
type TerminalSession = { process: IPty };
type EmitTerminalEvent = (id: string, event: TerminalEvent) => void;

export class TerminalManager {
  private readonly sessions = new Map<string, TerminalSession>();

  constructor(
    private readonly emit: EmitTerminalEvent,
    private readonly spawn: PtySpawner = spawnPty,
  ) {}

  spawnSession(input: { id: unknown; cwd: unknown; cols: unknown; rows: unknown }) {
    const id = validateTerminalId(input.id);
    if (this.sessions.has(id)) throw new Error("终端会话已存在");
    const cwd = validateTerminalCwd(input.cwd);
    const { cols, rows } = terminalSize(input.cols, input.rows);
    const shell = defaultShell();
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] =>
        typeof entry[1] === "string",
      ),
    );
    env.TERM = "xterm-256color";
    env.COLORTERM = "truecolor";

    const terminal = this.spawn(shell, [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd,
      env,
    });
    this.sessions.set(id, { process: terminal });
    terminal.onData((data) => {
      this.emit(id, { type: "output", data });
    });
    terminal.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id);
      this.emit(id, {
        type: "exit",
        code: exitCode,
        ...(signal ? { signal: String(signal) } : {}),
      });
    });
    return { id, shell };
  }

  write(idValue: unknown, data: unknown) {
    const session = this.session(idValue);
    if (typeof data !== "string") throw new Error("终端输入必须是字符串");
    session.process.write(data);
  }

  resize(idValue: unknown, colsValue: unknown, rowsValue: unknown) {
    const session = this.session(idValue);
    const { cols, rows } = terminalSize(colsValue, rowsValue);
    session.process.resize(cols, rows);
  }

  close(idValue: unknown) {
    const id = validateTerminalId(idValue);
    const session = this.sessions.get(id);
    this.sessions.delete(id);
    session?.process.kill();
  }

  shutdown() {
    const sessions = [...this.sessions.values()];
    this.sessions.clear();
    for (const session of sessions) session.process.kill();
  }

  private session(idValue: unknown) {
    const id = validateTerminalId(idValue);
    const session = this.sessions.get(id);
    if (!session) throw new Error("终端会话不存在或已结束");
    return session;
  }
}

export function terminalSize(colsValue: unknown, rowsValue: unknown) {
  return {
    cols: dimension(colsValue),
    rows: dimension(rowsValue),
  };
}

function dimension(value: unknown) {
  const number = typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : 80;
  return Math.min(MAX_TERMINAL_DIMENSION, Math.max(MIN_TERMINAL_DIMENSION, number));
}

function validateTerminalId(value: unknown) {
  if (typeof value !== "string" || !TERMINAL_ID_PATTERN.test(value)) {
    throw new Error("终端会话 ID 无效");
  }
  return value;
}

function validateTerminalCwd(value: unknown) {
  if (typeof value !== "string" || !value.trim()) throw new Error("请先选择 Workspace");
  let path: string;
  try {
    path = realpathSync(value);
  } catch {
    throw new Error(`终端工作目录不存在：${value}`);
  }
  if (!statSync(path).isDirectory()) throw new Error(`终端工作目录不是目录：${path}`);
  return path;
}

function defaultShell() {
  if (process.platform === "win32") return process.env.COMSPEC || "powershell.exe";
  return process.env.SHELL || "/bin/sh";
}
