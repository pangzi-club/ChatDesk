import type { IPty } from "node-pty";
import { describe, expect, it, vi } from "vitest";
import { TerminalManager, terminalSize, type TerminalEvent } from "./terminal-manager.js";

class FakePty {
  pid = 1;
  process = "test-shell";
  readonly write = vi.fn();
  readonly resize = vi.fn();
  readonly kill = vi.fn();
  private dataListener: (data: string) => void = () => undefined;
  private exitListener: (event: { exitCode: number; signal?: number }) => void = () => undefined;

  onData(listener: (data: string) => void) {
    this.dataListener = listener;
    return { dispose: () => undefined };
  }

  onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
    this.exitListener = listener;
    return { dispose: () => undefined };
  }

  emitData(data: string) {
    this.dataListener(data);
  }

  emitExit(exitCode: number) {
    this.exitListener({ exitCode });
  }
}

describe("TerminalManager", () => {
  it("bounds terminal dimensions", () => {
    expect(terminalSize(0, 20_000)).toEqual({ cols: 2, rows: 1_000 });
  });

  it("forwards output, input, resize and exit events", () => {
    const events: Array<{ id: string; event: TerminalEvent }> = [];
    const terminal = new FakePty();
    const spawn = vi.fn(() => terminal as unknown as IPty);
    const manager = new TerminalManager((id, event) => events.push({ id, event }), spawn);
    const id = "123e4567-e89b-12d3-a456-426614174000";

    manager.spawnSession({ id, cwd: process.cwd(), cols: 80, rows: 24 });
    terminal.emitData("hello");
    manager.write(id, "input");
    manager.resize(id, 120, 40);
    terminal.emitExit(0);

    expect(events).toEqual([
      { id, event: { type: "output", data: "hello" } },
      { id, event: { type: "exit", code: 0 } },
    ]);
    expect(terminal.write).toHaveBeenCalledWith("input");
    expect(terminal.resize).toHaveBeenCalledWith(120, 40);
    expect(() => manager.write(id, "later")).toThrow("终端会话不存在");
  });
});
