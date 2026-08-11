import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { chatServerRequest, loadChatServerMcp, saveChatServerMcp } from "@/lib/chat-server";

export type McpTransport = "npx" | "remote";
export type McpStatus = "unknown" | "ready" | "error";

export type McpServerConfig = {
  id: string;
  name: string;
  description: string;
  iconUrl?: string;
  source: "registry" | "custom";
  transport: McpTransport;
  packageName?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabledByDefault: boolean;
  status: McpStatus;
  lastError?: string;
  lastCheckedAt?: string;
};

export type McpRegistryEntry = McpServerConfig & { installed: boolean; popularity: number };

const REGISTRY_URL = "https://registry.modelcontextprotocol.io/v0/servers";

function isTauri() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function registryRelevance(entry: McpRegistryEntry, query: string) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  const name = entry.name.toLowerCase();
  return terms.reduce((score, term) => {
    if (name === term) return score + 1000;
    if (name.startsWith(term)) return score + 700;
    if (name.includes(term)) return score + 500;
    return score;
  }, 0);
}

function registryNameKey(name: string) {
  return name
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
    .replace(/[^a-z0-9\u4e00-\u9fff]/g, "");
}

function normalizeEntry(value: unknown): McpServerConfig | null {
  if (!isRecord(value)) return null;
  const transport =
    value.transport === "remote" ? "remote" : value.transport === "npx" ? "npx" : null;
  if (!transport) return null;
  const name = cleanString(value.name);
  if (!name) return null;
  const id = cleanString(value.id) || name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const url = cleanString(value.url);
  const packageName = cleanString(value.packageName);
  if (transport === "remote" && !/^https?:\/\//i.test(url)) return null;
  if (transport === "npx" && !packageName) return null;
  return {
    id,
    name,
    description: cleanString(value.description),
    iconUrl: cleanString(value.iconUrl) || undefined,
    source: value.source === "custom" ? "custom" : "registry",
    transport,
    packageName: packageName || undefined,
    command: cleanString(value.command) || (transport === "npx" ? "npx" : undefined),
    args: Array.isArray(value.args)
      ? value.args.filter((item): item is string => typeof item === "string")
      : undefined,
    env: isRecord(value.env)
      ? (Object.fromEntries(
          Object.entries(value.env).filter(([, item]) => typeof item === "string"),
        ) as Record<string, string>)
      : undefined,
    url: url || undefined,
    headers: isRecord(value.headers)
      ? (Object.fromEntries(
          Object.entries(value.headers).filter(([, item]) => typeof item === "string"),
        ) as Record<string, string>)
      : undefined,
    enabledByDefault: value.enabledByDefault === true,
    status: value.status === "ready" || value.status === "error" ? value.status : "unknown",
    lastError: cleanString(value.lastError) || undefined,
    lastCheckedAt: cleanString(value.lastCheckedAt) || undefined,
  };
}

export async function loadMcpServers(): Promise<McpServerConfig[]> {
  try {
    const serverValue = await loadChatServerMcp();
    if (Array.isArray(serverValue))
      return serverValue
        .map(normalizeEntry)
        .filter((item): item is McpServerConfig => Boolean(item));
  } catch (error) {
    console.error("Failed to load MCP settings from Chat Server", error);
  }
  return [];
}

export async function saveMcpServers(servers: McpServerConfig[]) {
  await saveChatServerMcp(servers);
}

export async function fetchMcpRegistry(query = ""): Promise<McpRegistryEntry[]> {
  const url = new URL(REGISTRY_URL);
  url.searchParams.set("limit", "100");
  if (query.trim()) url.searchParams.set("search", query.trim());
  const response = await (isTauri() ? tauriFetch(url) : fetch(url));
  if (!response.ok) throw new Error(`MCP Registry 请求失败 (${response.status})`);
  const payload = (await response.json()) as { servers?: unknown[] } | unknown[];
  const rows = Array.isArray(payload) ? payload : (payload.servers ?? []);
  const installed = await loadMcpServers();
  const entries = rows
    .map((row) => {
      const record = isRecord(row) && isRecord(row.server) ? row.server : row;
      const meta = isRecord(record) ? record : {};
      const packages = Array.isArray(meta.packages) ? meta.packages : [];
      const npm = packages.find(
        (item) => isRecord(item) && cleanString(item.registryType) === "npm",
      ) as Record<string, unknown> | undefined;
      const remotes = Array.isArray(meta.remotes) ? meta.remotes : [];
      const remote = remotes.find(
        (item) => isRecord(item) && cleanString(item.type).toLowerCase().includes("streamable"),
      ) as Record<string, unknown> | undefined;
      const base = {
        id: cleanString(meta.name),
        name: cleanString(meta.title) || cleanString(meta.name),
        description: cleanString(meta.description),
        iconUrl: cleanString(meta.icons && isRecord(meta.icons) ? meta.icons.src : "") || undefined,
        source: "registry" as const,
        transport: npm ? ("npx" as const) : ("remote" as const),
        packageName: npm ? cleanString(npm.identifier) : undefined,
        command: npm ? "npx" : undefined,
        args: npm ? ["-y", cleanString(npm.identifier)] : undefined,
        url: remote ? cleanString(remote.url) : undefined,
        enabledByDefault: false,
        status: "unknown" as const,
      };
      const normalized = normalizeEntry(base);
      const popularity =
        typeof meta.popularity === "number"
          ? meta.popularity
          : typeof meta.downloads === "number"
            ? meta.downloads
            : typeof meta.useCount === "number"
              ? meta.useCount
              : isRecord(meta.repository) && typeof meta.repository.stars === "number"
                ? meta.repository.stars
                : 0;
      return normalized
        ? {
            ...normalized,
            installed: installed.some((item) => item.id === normalized.id),
            popularity,
          }
        : null;
    })
    .filter((item): item is McpRegistryEntry => Boolean(item));
  const unique = new Map<string, McpRegistryEntry>();
  for (const entry of entries) {
    const key = registryNameKey(entry.name);
    const previous = unique.get(key);
    if (!previous || entry.popularity > previous.popularity) unique.set(key, entry);
  }
  const candidates = [...unique.values()].filter(
    (entry) => !query.trim() || registryRelevance(entry, query) > 0,
  );
  return candidates.sort((a, b) => {
    const relevanceDelta = registryRelevance(b, query) - registryRelevance(a, query);
    return relevanceDelta || b.popularity - a.popularity;
  });
}

export function startMcp(server: McpServerConfig) {
  return chatServerRequest("/v1/mcp/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(server),
  }).then(() => undefined);
}

export function listMcpTools(serverId: string) {
  return chatServerRequest(`/v1/mcp/${encodeURIComponent(serverId)}/tools`).then(
    (response) => response.json() as Promise<McpToolDefinition[]>,
  );
}

export function callMcpTool(serverId: string, toolName: string, arguments_: unknown) {
  return chatServerRequest(`/v1/mcp/${encodeURIComponent(serverId)}/call`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ toolName, arguments: arguments_ }),
  }).then((response) => response.json());
}

export function stopMcp(serverId: string) {
  return chatServerRequest(`/v1/mcp/${encodeURIComponent(serverId)}/stop`, { method: "POST" }).then(
    () => undefined,
  );
}

export function testMcpConnection(server: McpServerConfig) {
  return chatServerRequest("/v1/mcp/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(server),
  }).then((response) => response.json() as Promise<McpToolDefinition[]>);
}

export type McpToolDefinition = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};
