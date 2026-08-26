import { tool } from "ai";
import { z } from "zod";
import type { MemoryStore } from "./memory-store.ts";

export const SEARCH_MEMORY_TOOL_NAME = "search_memory";

export function createSearchMemoryTool(memory: MemoryStore, workspaceId?: string) {
  return tool({
    description:
      "Search detailed long-term memories relevant to the current request. Use only when the memory summary suggests relevant prior preferences, constraints, decisions, or project context.",
    inputSchema: z.object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(8).optional(),
    }),
    execute: async ({ query, limit }) => {
      const items = await memory.search(query, workspaceId, limit ?? 8);
      return {
        items: items.map((item) => ({
          id: item.id,
          content: item.content,
          scope: item.scope,
          category: item.category,
          updatedAt: item.updatedAt,
        })),
      };
    },
  });
}
