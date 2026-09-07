import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compressMcpToolResult, McpRuntime } from "./mcp-runtime.ts";

const { createMCPClientMock, transportConfigs } = vi.hoisted(() => ({
  createMCPClientMock: vi.fn(),
  transportConfigs: [] as unknown[],
}));

vi.mock("@ai-sdk/mcp", () => ({ createMCPClient: createMCPClientMock }));
vi.mock("@ai-sdk/mcp/mcp-stdio", () => ({
  Experimental_StdioMCPTransport: class StdioMCPTransport {
    constructor(config: unknown) {
      transportConfigs.push(config);
    }
  },
}));

function createClient() {
  const client = {
    tools: vi.fn(async () => ({
      click: {
        description: "Click a desktop target",
        execute: vi.fn(),
      },
    })),
    listTools: vi.fn(async () => ({ tools: [{ name: "click", description: "Click" }] })),
    callTool: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
    close: vi.fn(async () => undefined),
  };
  createMCPClientMock.mockResolvedValue(client);
  return client;
}

describe("McpRuntime", () => {
  beforeEach(() => {
    createMCPClientMock.mockReset();
    transportConfigs.length = 0;
  });

  afterEach(() => vi.unstubAllEnvs());

  it("compresses inline MCP image content", async () => {
    const result = await compressMcpToolResult({
      content: [
        {
          type: "image",
          data: Buffer.from("not really an image").toString("base64"),
          mimeType: "image/png",
        },
      ],
    });
    expect(result).toEqual({
      content: [
        {
          type: "image",
          data: Buffer.from("not really an image").toString("base64"),
          mimeType: "image/png",
        },
      ],
    });
  });

  it("loads selected servers and namespaces their tools", async () => {
    const client = createClient();
    const runtime = new McpRuntime();
    const tools = await runtime.toolsForServers(
      [
        { id: "computer-use", transport: "stdio", command: "cua-driver", args: ["mcp"] },
        { id: "ignored", transport: "stdio", command: "ignored" },
      ],
      ["computer-use"],
    );

    expect(Object.keys(tools)).toEqual(["mcp__computer-use__click"]);
    expect(client.tools).toHaveBeenCalledWith({ schemas: "automatic" });
    expect(createMCPClientMock).toHaveBeenCalledTimes(1);
  });

  it("inherits the process environment and applies server overrides", async () => {
    vi.stubEnv("CHATDESK_MCP_INHERITED", "inherited");
    createClient();
    const runtime = new McpRuntime();

    await runtime.start({
      id: "stdio",
      transport: "stdio",
      command: "driver",
      env: { CHATDESK_MCP_OVERRIDE: "legacy" },
      environment: [
        { name: "CHATDESK_MCP_OVERRIDE", value: "generated" },
        { name: "CHATDESK_MCP_SOCKET", value: "/tmp/driver.sock" },
      ],
    });

    expect(transportConfigs).toEqual([
      expect.objectContaining({
        env: expect.objectContaining({
          CHATDESK_MCP_INHERITED: "inherited",
          CHATDESK_MCP_OVERRIDE: "generated",
          CHATDESK_MCP_SOCKET: "/tmp/driver.sock",
        }),
      }),
    ]);
  });

  it("reuses and closes a connected client", async () => {
    const client = createClient();
    const runtime = new McpRuntime();
    const server = { id: "remote", transport: "remote", url: "https://example.test/mcp" };

    await runtime.start(server);
    await runtime.start(server);
    expect(createMCPClientMock).toHaveBeenCalledTimes(1);

    await runtime.stop("remote");
    expect(client.close).toHaveBeenCalledTimes(1);
  });
});
