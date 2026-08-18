import { Channel, invoke } from "@tauri-apps/api/core";
import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { getDesktopBridge } from "@/lib/desktop-bridge";

export type TerminalSessionStatus =
  | { phase: "starting" }
  | { phase: "running"; shell: string }
  | { phase: "exited"; code: number; signal?: string }
  | { phase: "error"; message: string };

type TerminalEvent =
  | { type: "output"; data: string | number[] | Uint8Array }
  | { type: "exit"; code: number; signal?: string }
  | { type: "error"; message: string };

type TerminalSpawnResult = {
  id: string;
  shell: string;
};

type StatusListener = (status: TerminalSessionStatus) => void;

type TerminalEntry = {
  terminal: Terminal;
  fitAddon: FitAddon;
  cwd: string;
  id?: string;
  status: TerminalSessionStatus;
  listeners: Set<StatusListener>;
  disposed: boolean;
  spawning: boolean;
  lastSize?: { cols: number; rows: number };
  unsubscribe?: () => void;
};

export type MountedTerminalSession = {
  clear: () => void;
  detach: () => void;
  fit: () => void;
  focus: () => void;
  status: TerminalSessionStatus;
};

function resolvedCssColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function terminalTheme(): ITheme {
  return {
    background: resolvedCssColor("--card", "#ffffff"),
    foreground: resolvedCssColor("--foreground", "#202123"),
    cursor: resolvedCssColor("--primary", "#2f80ed"),
    cursorAccent: resolvedCssColor("--primary-foreground", "#ffffff"),
    selectionBackground: resolvedCssColor("--accent", "#e9e9eb"),
    selectionForeground: resolvedCssColor("--accent-foreground", "#202123"),
  };
}

export function terminalEventBytes(data: number[] | Uint8Array) {
  return data instanceof Uint8Array ? data : Uint8Array.from(data);
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function terminalSupported() {
  return getDesktopBridge() !== null;
}

export class TerminalSessionRegistry {
  private readonly entries = new Map<string, TerminalEntry>();

  mount(
    key: string,
    cwd: string,
    container: HTMLElement,
    onStatus: StatusListener,
  ): MountedTerminalSession {
    const entry = this.entries.get(key) ?? this.create(key, cwd);
    entry.listeners.add(onStatus);
    onStatus(entry.status);

    container.replaceChildren();
    if (entry.terminal.element) {
      container.append(entry.terminal.element);
    } else {
      entry.terminal.open(container);
    }
    this.updateTheme(key);
    this.fit(key);

    if (!entry.id && !entry.spawning && entry.status.phase === "starting") {
      void this.spawn(key);
    }

    return {
      clear: () => entry.terminal.clear(),
      detach: () => entry.listeners.delete(onStatus),
      fit: () => this.fit(key),
      focus: () => entry.terminal.focus(),
      status: entry.status,
    };
  }

  updateTheme(key: string) {
    const entry = this.entries.get(key);
    if (entry) entry.terminal.options.theme = terminalTheme();
  }

  async close(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return;
    this.entries.delete(key);
    entry.disposed = true;
    entry.listeners.clear();
    entry.unsubscribe?.();
    entry.terminal.dispose();
    if (entry.id) {
      const bridge = getDesktopBridge();
      if (bridge?.runtime === "electron") {
        await bridge.call("terminal_close", { id: entry.id });
      } else {
        await invoke("terminal_close", { id: entry.id });
      }
    }
  }

  async closeAll() {
    await Promise.allSettled([...this.entries.keys()].map((key) => this.close(key)));
  }

  private create(key: string, cwd: string) {
    const terminal = new Terminal({
      allowProposedApi: false,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: "block",
      fontFamily: '"SFMono-Regular", "Cascadia Code", "Roboto Mono", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      scrollback: 5_000,
      theme: terminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    const entry: TerminalEntry = {
      terminal,
      fitAddon,
      cwd,
      status: { phase: "starting" },
      listeners: new Set(),
      disposed: false,
      spawning: false,
    };
    terminal.onData((data) => {
      if (!entry.id || entry.status.phase !== "running") return;
      const bridge = getDesktopBridge();
      const write =
        bridge?.runtime === "electron"
          ? bridge.call("terminal_write", { id: entry.id, data })
          : invoke("terminal_write", { id: entry.id, data });
      void write.catch((error) => {
        this.setStatus(entry, { phase: "error", message: describeError(error) });
      });
    });
    this.entries.set(key, entry);
    return entry;
  }

  private async spawn(key: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.disposed) return;
    if (!terminalSupported()) {
      this.setStatus(entry, { phase: "error", message: "Terminal 仅在桌面应用中可用" });
      return;
    }
    entry.spawning = true;

    const onEvent = (event: TerminalEvent) => {
      if (entry.disposed) return;
      if (event.type === "output") {
        entry.terminal.write(
          typeof event.data === "string" ? event.data : terminalEventBytes(event.data),
        );
      } else if (event.type === "exit") {
        this.setStatus(entry, { phase: "exited", code: event.code, signal: event.signal });
      } else {
        this.setStatus(entry, { phase: "error", message: event.message });
      }
    };

    let unsubscribe: (() => void) | undefined;
    try {
      const bridge = getDesktopBridge();
      let result: TerminalSpawnResult;
      if (bridge?.runtime === "electron") {
        const id = crypto.randomUUID();
        unsubscribe = await bridge.subscribe(`terminal:${id}`, (payload) =>
          onEvent(payload as TerminalEvent),
        );
        result = await bridge.call<TerminalSpawnResult>("terminal_spawn", {
          id,
          cwd: entry.cwd,
          cols: entry.terminal.cols,
          rows: entry.terminal.rows,
        });
      } else {
        const channel = new Channel<TerminalEvent>();
        channel.onmessage = onEvent;
        result = await invoke<TerminalSpawnResult>("terminal_spawn", {
          cwd: entry.cwd,
          cols: entry.terminal.cols,
          rows: entry.terminal.rows,
          onEvent: channel,
        });
      }
      if (entry.disposed) {
        unsubscribe?.();
        if (bridge?.runtime === "electron") {
          await bridge.call("terminal_close", { id: result.id });
        } else {
          await invoke("terminal_close", { id: result.id });
        }
        return;
      }
      entry.id = result.id;
      entry.unsubscribe = unsubscribe;
      entry.spawning = false;
      this.setStatus(entry, { phase: "running", shell: result.shell });
      this.fit(key);
    } catch (error) {
      unsubscribe?.();
      entry.unsubscribe?.();
      entry.unsubscribe = undefined;
      entry.spawning = false;
      this.setStatus(entry, { phase: "error", message: describeError(error) });
    }
  }

  private fit(key: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.disposed) return;
    try {
      entry.fitAddon.fit();
    } catch {
      return;
    }
    const nextSize = { cols: entry.terminal.cols, rows: entry.terminal.rows };
    if (
      !entry.id ||
      (entry.lastSize?.cols === nextSize.cols && entry.lastSize.rows === nextSize.rows)
    ) {
      return;
    }
    entry.lastSize = nextSize;
    const bridge = getDesktopBridge();
    const resize =
      bridge?.runtime === "electron"
        ? bridge.call("terminal_resize", { id: entry.id, ...nextSize })
        : invoke("terminal_resize", { id: entry.id, ...nextSize });
    void resize.catch((error) => {
      this.setStatus(entry, { phase: "error", message: describeError(error) });
    });
  }

  private setStatus(entry: TerminalEntry, status: TerminalSessionStatus) {
    entry.status = status;
    for (const listener of entry.listeners) listener(status);
  }
}

export const terminalSessions = new TerminalSessionRegistry();
