import type { MemoryOverview } from "@chatdesk/shared";
import { loadChatServerMemory } from "@/lib/chat-server";

export const DEFAULT_CHAT_MEMORY: MemoryOverview = {
  schemaVersion: 2,
  settings: {
    useMemories: true,
    generateMemories: true,
    skipExternalContext: true,
    maxUnusedDays: 90,
  },
  summaries: [],
  items: [],
  pipeline: {
    queuedJobs: 0,
    runningJobs: 0,
    failedJobs: 0,
  },
};

export async function loadChatMemory(): Promise<MemoryOverview> {
  return loadChatServerMemory();
}
