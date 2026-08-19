import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { createMCPClient } from "@ai-sdk/mcp";

type ServerConfig = {
  id: string;
  transport?: "npx" | "remote";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  packageName?: string;
  url?: string;
  headers?: Record<string, string>;
};

type ProcessHandle = {
  child: ChildProcessWithoutNullStreams;
  nextId: number;
  pending: Map<number, (value: unknown) => void>;
};

function asConfig(value: unknown) {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") {
    throw new Error("MCP 配置无效");
  }
  return value as ServerConfig;
}

export class McpRuntime {
  private readonly processes = new Map<string, ProcessHandle>();
  private readonly remotes = new Map<string, Awaited<ReturnType<typeof createMCPClient>>>();

  async start(value: unknown) {
    const server = asConfig(value);
    if (server.transport === "remote") {
      if (!server.url) throw new Error("MCP remote URL 未配置");
      const client = await createMCPClient({
        transport: { type: "http", url: server.url, headers: server.headers },
      });
      this.remotes.set(server.id, client);
      return;
    }
    if (this.processes.has(server.id)) return;
    const command = server.command || "npx";
    const args = server.args?.length ? server.args : ["-y", server.packageName || ""];
    const child = spawn(command, args, {
      env: { ...process.env, ...(server.env ?? {}) },
      stdio: "pipe",
    });
    const handle: ProcessHandle = { child, nextId: 0, pending: new Map() };
    const lines = createInterface({ input: child.stdout });
    child.stderr.on("data", (chunk) => {
      console.error(`[Chat Server] MCP ${server.id} stderr: ${String(chunk).trimEnd()}`);
    });
    lines.on("line", (line) => {
      try {
        const payload = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown };
        if (typeof payload.id !== "number") return;
        const resolve = handle.pending.get(payload.id);
        if (!resolve) return;
        handle.pending.delete(payload.id);
        if (payload.error) resolve({ error: payload.error });
        else resolve(payload.result);
      } catch {
        // Ignore non-JSON diagnostics emitted on stdout.
      }
    });
    child.once("exit", () => {
      if (this.processes.get(server.id) !== handle) return;
      for (const resolve of handle.pending.values()) resolve({ error: "MCP 进程已退出" });
      handle.pending.clear();
      this.processes.delete(server.id);
    });
    child.once("error", (error) => {
      if (this.processes.get(server.id) !== handle) return;
      for (const resolve of handle.pending.values()) resolve({ error: error.message });
      handle.pending.clear();
      this.processes.delete(server.id);
      console.error(`[Chat Server] MCP ${server.id} 进程错误: ${error.message}`);
    });
    child.stdin.on("error", (error) => {
      if (this.processes.get(server.id) !== handle) return;
      for (const resolve of handle.pending.values()) resolve({ error: error.message });
      handle.pending.clear();
      this.processes.delete(server.id);
      console.error(`[Chat Server] MCP ${server.id} stdin 错误: ${error.message}`);
    });
    this.processes.set(server.id, handle);
    await this.rpc(server.id, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "ChatDesk", version: "0.4.0" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
  }

  async listTools(serverId: string) {
    const remote = this.remotes.get(serverId);
    if (remote) {
      const tools = await remote.tools();
      return Object.entries(tools).map(([name, tool]) => ({ name, description: tool.description }));
    }
    const result = (await this.rpc(serverId, "tools/list", {})) as { tools?: unknown[] };
    return Array.isArray(result?.tools) ? result.tools : [];
  }

  async callTool(serverId: string, toolName: string, arguments_: unknown) {
    const remote = this.remotes.get(serverId);
    if (remote)
      return remote.callTool({ name: toolName, arguments: arguments_ as Record<string, unknown> });
    return this.rpc(serverId, "tools/call", { name: toolName, arguments: arguments_ });
  }

  async stop(serverId: string) {
    const remote = this.remotes.get(serverId);
    if (remote) {
      await remote.close().catch(() => undefined);
      this.remotes.delete(serverId);
    }
    const process = this.processes.get(serverId);
    if (process) {
      process.child.kill();
      this.processes.delete(serverId);
    }
  }

  async close() {
    const serverIds = new Set([...this.remotes.keys(), ...this.processes.keys()]);
    await Promise.all([...serverIds].map((serverId) => this.stop(serverId)));
  }

  async test(value: unknown) {
    const server = asConfig(value);
    await this.start(server);
    return this.listTools(server.id);
  }

  private async rpc(serverId: string, method: string, params: unknown) {
    const handle = this.processes.get(serverId);
    if (!handle) throw new Error("MCP 尚未启动");
    const id = ++handle.nextId;
    const result = new Promise<unknown>((resolve) => handle.pending.set(id, resolve));
    try {
      handle.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    } catch (error) {
      handle.pending.delete(id);
      throw error;
    }
    const payload = await result;
    if (payload && typeof payload === "object" && "error" in payload) {
      throw new Error(JSON.stringify((payload as { error: unknown }).error));
    }
    return payload;
  }
}
