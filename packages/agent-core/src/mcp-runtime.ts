import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";
import { Experimental_StdioMCPTransport as StdioMCPTransport } from "@ai-sdk/mcp/mcp-stdio";
import type { ToolSet } from "ai";

type EnvironmentVariable = { name: string; value: string };

export type McpServerConfig = {
  id: string;
  transport?: "npx" | "remote" | "stdio";
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  environment?: EnvironmentVariable[];
  packageName?: string;
  url?: string;
  headers?: Record<string, string>;
  enabledByDefault?: boolean;
};

function asConfig(value: unknown): McpServerConfig {
  if (!value || typeof value !== "object" || typeof (value as { id?: unknown }).id !== "string") {
    throw new Error("MCP 配置无效");
  }
  return value as McpServerConfig;
}

function environmentOf(server: McpServerConfig) {
  return {
    ...Object.fromEntries(
      Object.entries(process.env).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    ),
    ...(server.env ?? {}),
    ...Object.fromEntries(
      (server.environment ?? [])
        .filter(
          (item): item is EnvironmentVariable =>
            Boolean(item) && typeof item.name === "string" && typeof item.value === "string",
        )
        .map((item) => [item.name, item.value]),
    ),
  };
}

function namespaceToolName(serverId: string, toolName: string) {
  const safeServerId = serverId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeToolName = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${safeServerId}__${safeToolName}`;
}

function stdioConfig(server: McpServerConfig) {
  return {
    command: server.command || "npx",
    args: server.args?.length ? server.args : ["-y", server.packageName || ""],
    env: environmentOf(server),
  };
}

export class McpRuntime {
  private readonly clients = new Map<string, MCPClient>();
  private readonly starting = new Map<string, Promise<MCPClient>>();

  async start(value: unknown) {
    const server = asConfig(value);
    if (this.clients.has(server.id)) return;
    const client = await this.connect(server);
    this.clients.set(server.id, client);
  }

  async toolsForServers(values: unknown[], serverIds: string[]): Promise<ToolSet> {
    const selected = new Set(serverIds);
    const tools: ToolSet = {};
    for (const value of values) {
      if (!value || typeof value !== "object") continue;
      const id = (value as { id?: unknown }).id;
      if (typeof id !== "string" || !selected.has(id)) continue;
      const server = asConfig(value);
      await this.start(server);
      const client = this.clients.get(server.id);
      if (!client) continue;
      const serverTools = await client.tools({ schemas: "automatic" });
      for (const [name, tool] of Object.entries(serverTools)) {
        tools[namespaceToolName(server.id, name)] = tool as ToolSet[string];
      }
    }
    return tools;
  }

  async listTools(serverId: string) {
    const client = this.clients.get(serverId);
    if (!client) throw new Error("MCP 尚未启动");
    const result = await client.listTools();
    return result.tools;
  }

  async callTool(serverId: string, toolName: string, arguments_: unknown) {
    const client = this.clients.get(serverId);
    if (!client) throw new Error("MCP 尚未启动");
    return client.callTool({
      name: toolName,
      arguments: arguments_ as Record<string, unknown>,
    });
  }

  async stop(serverId: string) {
    const client = this.clients.get(serverId);
    this.clients.delete(serverId);
    if (client) await client.close().catch(() => undefined);
  }

  async close() {
    const clients = [...this.clients.entries()];
    this.clients.clear();
    await Promise.all(clients.map(([, client]) => client.close().catch(() => undefined)));
  }

  async test(value: unknown) {
    const server = asConfig(value);
    await this.start(server);
    return this.listTools(server.id);
  }

  private async connect(server: McpServerConfig) {
    const existing = this.starting.get(server.id);
    if (existing) return existing;
    const promise = this.createClient(server);
    this.starting.set(server.id, promise);
    try {
      return await promise;
    } finally {
      this.starting.delete(server.id);
    }
  }

  private async createClient(server: McpServerConfig) {
    if (server.transport === "remote") {
      if (!server.url) throw new Error("MCP remote URL 未配置");
      return createMCPClient({
        transport: { type: "http", url: server.url, headers: server.headers },
        clientName: "ChatDesk",
        version: "0.6.0",
      });
    }
    return createMCPClient({
      transport: new StdioMCPTransport(stdioConfig(server)),
      clientName: "ChatDesk",
      version: "0.6.0",
    });
  }
}
