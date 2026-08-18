import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { ChatServerSupervisor } from "./chat-server-supervisor.js";

class FakeHostProcess extends EventEmitter {
  readonly signals: NodeJS.Signals[] = [];

  kill(signal: NodeJS.Signals = "SIGTERM") {
    this.signals.push(signal);
    return true;
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null) {
    this.emit("exit", code, signal);
  }
}

describe("ChatServerSupervisor", () => {
  it("starts the server with an authenticated loopback configuration", async () => {
    const child = new FakeHostProcess();
    const spawnImpl = vi.fn(() => child);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200 }));
    const supervisor = new ChatServerSupervisor({
      command: "node",
      args: ["chat-server.cjs"],
      dataDir: "/tmp/chatdesk-test",
      token: "test-token",
      spawnImpl,
      fetchImpl,
    });

    const info = await supervisor.start();

    expect(info).toMatchObject({
      host: "127.0.0.1",
      port: 14317,
      token: "test-token",
      managed: true,
      running: true,
      state: "running",
    });
    expect(spawnImpl).toHaveBeenCalledWith(
      "node",
      ["chat-server.cjs"],
      expect.objectContaining({
        env: expect.objectContaining({
          CHAT_SERVER_DATA_DIR: "/tmp/chatdesk-test",
          CHAT_SERVER_HOST: "127.0.0.1",
          CHAT_SERVER_PORT: "14317",
          CHAT_SERVER_PRODUCTION: "1",
          CHAT_SERVER_TOKEN: "test-token",
        }),
      }),
    );
    expect(fetchImpl).toHaveBeenCalledWith("http://127.0.0.1:14317/v1/sessions", {
      headers: { Authorization: "Bearer test-token" },
      signal: expect.any(AbortSignal),
    });

    await supervisor.stop();
  });

  it("does not accept an unrelated server that only owns the same port", async () => {
    const child = new FakeHostProcess();
    const supervisor = new ChatServerSupervisor({
      command: "node",
      args: ["chat-server.cjs"],
      token: "new-server-token",
      startupTimeoutMs: 250,
      spawnImpl: () => child,
      fetchImpl: async (_input, init) =>
        new Response(null, {
          status:
            new Headers(init?.headers).get("Authorization") === "Bearer old-server-token"
              ? 200
              : 401,
        }),
    });

    await expect(supervisor.start()).rejects.toThrow("Chat Server 返回 HTTP 401");
    expect(child.signals).toEqual(["SIGTERM"]);
    expect(supervisor.info()).toMatchObject({
      running: false,
      state: "offline",
      lastExit: "Chat Server 返回 HTTP 401",
    });
  });

  it("restarts an unexpectedly exited server up to the configured limit", async () => {
    const children: FakeHostProcess[] = [];
    const spawnImpl = vi.fn(() => {
      const child = new FakeHostProcess();
      children.push(child);
      return child;
    });
    const supervisor = new ChatServerSupervisor({
      command: "node",
      maxRestartAttempts: 1,
      restartDelayMs: 0,
      spawnImpl,
      fetchImpl: async () => new Response(null, { status: 200 }),
    });

    await supervisor.start();
    children[0].exit(1);
    await vi.waitFor(() => expect(children).toHaveLength(2));
    await vi.waitFor(() => expect(supervisor.info().state).toBe("running"));

    children[1].exit(1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(children).toHaveLength(2);
    expect(supervisor.info()).toMatchObject({
      running: false,
      state: "offline",
      restartAttempt: 2,
      lastExit: "code 1",
    });
  });

  it("does not restart after an explicit stop", async () => {
    const child = new FakeHostProcess();
    const spawnImpl = vi.fn(() => child);
    const supervisor = new ChatServerSupervisor({
      command: "node",
      restartDelayMs: 0,
      spawnImpl,
      fetchImpl: async () => new Response(null, { status: 200 }),
    });

    await supervisor.start();
    await supervisor.stop();
    child.exit(0, "SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(child.signals).toEqual(["SIGTERM"]);
    expect(spawnImpl).toHaveBeenCalledTimes(1);
    expect(supervisor.info()).toMatchObject({ running: false, state: "offline" });
  });
});
