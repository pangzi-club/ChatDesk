import { createMCPClient } from "@ai-sdk/mcp";
import { jsonSchema, type ToolSet, tool } from "ai";
import { z } from "zod";
import { callMcpTool, listMcpTools, type McpServerConfig, startMcp, stopMcp } from "@/lib/mcp";

function namespace(server: McpServerConfig, toolName: string) {
  const safe = server.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `mcp__${safe}__${toolName}`;
}

const remoteClients = new Map<string, { close: () => Promise<void> }>();
const startedNpxServers = new Set<string>();
const toolCache = new Map<string, { fingerprint: string; tools: ToolSet }>();

function fingerprint(server: McpServerConfig) {
  return JSON.stringify({
    transport: server.transport,
    command: server.command,
    args: server.args,
    env: server.env,
    url: server.url,
    headers: server.headers,
  });
}

function remoteTools(server: McpServerConfig, tools: ToolSet): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, value]) => [namespace(server, name), value]),
  );
}

async function npxTools(server: McpServerConfig): Promise<ToolSet> {
  await startMcp(server);
  startedNpxServers.add(server.id);
  const definitions = await listMcpTools(server.id);
  return Object.fromEntries(
    definitions.map((definition) => [
      namespace(server, definition.name),
      tool({
        description: definition.description ?? `MCP tool ${definition.name}`,
        inputSchema: definition.inputSchema
          ? jsonSchema(definition.inputSchema as Record<string, unknown>)
          : z.record(z.string(), z.unknown()),
        execute: (arguments_: unknown) => callMcpTool(server.id, definition.name, arguments_),
      }),
    ]),
  );
}

export async function loadMcpTools(server: McpServerConfig): Promise<ToolSet> {
  const nextFingerprint = fingerprint(server);
  const cached = toolCache.get(server.id);
  if (cached?.fingerprint === nextFingerprint) return cached.tools;
  if (cached) await closeMcpServers([server.id]);

  let tools: ToolSet;
  if (server.transport === "npx") {
    tools = await npxTools(server);
    toolCache.set(server.id, { fingerprint: nextFingerprint, tools });
    return tools;
  }
  if (!server.url) throw new Error("MCP remote URL 未配置");
  const client = await createMCPClient({
    transport: { type: "http", url: server.url, headers: server.headers },
  });
  const previous = remoteClients.get(server.id);
  if (previous) await previous.close().catch(() => undefined);
  remoteClients.set(server.id, client);
  tools = remoteTools(server, await client.tools());
  toolCache.set(server.id, { fingerprint: nextFingerprint, tools });
  return tools;
}

export async function loadMcpToolsForServers(servers: McpServerConfig[]): Promise<ToolSet> {
  const toolSets = await Promise.all(
    servers.map(async (server) => {
      try {
        return await loadMcpTools(server);
      } catch (error) {
        console.error(`MCP ${server.name} failed`, error);
        return {};
      }
    }),
  );
  return Object.assign({}, ...toolSets);
}

export async function closeMcpClients() {
  await closeMcpServers([...remoteClients.keys(), ...startedNpxServers]);
}

export async function closeMcpServers(serverIds: string[]) {
  const ids = new Set(serverIds);
  for (const serverId of ids) toolCache.delete(serverId);
  const clients = [...remoteClients.entries()].filter(([serverId]) => ids.has(serverId));
  for (const [serverId] of clients) remoteClients.delete(serverId);
  await Promise.allSettled(clients.map(([, client]) => client.close()));
  const npxIds = [...startedNpxServers].filter((serverId) => ids.has(serverId));
  for (const serverId of npxIds) startedNpxServers.delete(serverId);
  await Promise.allSettled(npxIds.map((serverId) => stopMcp(serverId)));
}

export { namespace };
