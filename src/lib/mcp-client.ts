import { createMCPClient } from "@ai-sdk/mcp";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { callMcpTool, listMcpTools, type McpServerConfig, startMcp } from "@/lib/mcp";

function namespace(server: McpServerConfig, toolName: string) {
  const safe = server.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${safe}__${toolName}`;
}

const remoteClients = new Map<string, { close: () => Promise<void> }>();

function remoteTools(server: McpServerConfig, tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, value]) => [namespace(server, name), value]),
  );
}

async function npxTools(server: McpServerConfig): Promise<ToolSet> {
  await startMcp(server);
  const definitions = await listMcpTools(server.id);
  return Object.fromEntries(
    definitions.map((definition) => [
      namespace(server, definition.name),
      tool({
        description: definition.description ?? `MCP tool ${definition.name}`,
        inputSchema: z.record(z.string(), z.unknown()),
        execute: (arguments_: unknown) => callMcpTool(server.id, definition.name, arguments_),
      }),
    ]),
  );
}

export async function loadMcpTools(server: McpServerConfig): Promise<ToolSet> {
  if (server.transport === "npx") return npxTools(server);
  if (!server.url) throw new Error("MCP remote URL 未配置");
  const client = await createMCPClient({
    transport: { type: "http", url: server.url, headers: server.headers },
  });
  remoteClients.set(server.id, client);
  return remoteTools(server, await client.tools());
}

export async function closeMcpClients() {
  const clients = [...remoteClients.values()];
  remoteClients.clear();
  await Promise.allSettled(clients.map((client) => client.close()));
}

export { namespace };
