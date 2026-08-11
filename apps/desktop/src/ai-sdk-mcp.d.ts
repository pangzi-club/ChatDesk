declare module "@ai-sdk/mcp" {
  import type { ToolSet } from "ai";
  export function createMCPClient(options: {
    transport: { type: "http"; url: string; headers?: Record<string, string> };
  }): Promise<{ tools(): Promise<ToolSet>; close(): Promise<void> }>;
}
