import {
  type ChatMemoryItem,
  type ChatMemoryStore,
  loadChatMemory,
  mergeMemoryItems,
  replaceMemoryItemsFromFacts,
  saveChatMemory,
  shouldCompactMemory,
} from "@/lib/chat/chat-memory";
import {
  compactChatServerMemoryFacts,
  extractChatServerMemoryFacts,
} from "@/lib/server/chat-server";
import type { ModelConfig } from "@/lib/server/models";

let memoryJobQueue: Promise<void> = Promise.resolve();

function enqueueMemoryJob(job: () => Promise<void>) {
  memoryJobQueue = memoryJobQueue
    .then(job)
    .catch((error) => console.error("Chat memory background job failed", error));
  return memoryJobQueue;
}

function isDemoModel(model: ModelConfig | undefined) {
  return !model || model.baseUrl.startsWith("local://");
}

/**
 * Model calls for memory live on the Chat Server so their token usage is
 * recorded through the shared usage log; the renderer only sends ids and text.
 */
function modelReference(model: ModelConfig) {
  return model.id || model.name;
}

function memoryItemContents(items: readonly ChatMemoryItem[]) {
  return items.map((item) => item.content);
}

const WORKSPACE_MEMORY_EXCLUDED_TOOLS = new Set([
  "list_dir",
  "search_files",
  "read_file",
  "write_file",
  "edit_file",
  "apply_patch",
  "bash",
]);

export function isWorkspaceMemoryExcludedTool(toolName: string) {
  return WORKSPACE_MEMORY_EXCLUDED_TOOLS.has(toolName);
}

const EXPLICIT_MEMORY_INTENT_PATTERN =
  /(?:请?记住|记一下|记得|别忘了|不要忘记|以后(?:请|都|要)|今后(?:请|都|要)|始终)/i;

export function hasExplicitMemoryIntent(userText: string) {
  return EXPLICIT_MEMORY_INTENT_PATTERN.test(userText);
}

async function extractFactsFromTurn(
  model: ModelConfig,
  userText: string,
  assistantText: string,
  existingItems: ChatMemoryItem[],
  workspacePath?: string,
): Promise<string[]> {
  const { facts } = await extractChatServerMemoryFacts({
    modelId: modelReference(model),
    items: memoryItemContents(existingItems),
    workspacePath,
    userText,
    assistantText,
  });
  return facts;
}

function isWorkspaceContextFact(fact: string, workspacePath?: string) {
  const normalized = fact.trim().toLowerCase();
  if (!normalized) return true;
  if (workspacePath && normalized.includes(workspacePath.trim().toLowerCase())) return true;
  return /(当前|用户的)?\s*(workspace|工作目录|工作区|开发工作目录)\s*(是|为|路径)?\s*[/~]/i.test(
    fact,
  );
}

async function compactFactsWithModel(
  model: ModelConfig,
  items: ChatMemoryItem[],
): Promise<string[]> {
  const { facts } = await compactChatServerMemoryFacts({
    modelId: modelReference(model),
    items: memoryItemContents(items),
  });
  return facts;
}

export type MemoryTurnPayload = {
  model: ModelConfig | undefined;
  sessionId: string;
  userText: string;
  assistantText: string;
  workspacePath?: string;
  toolNames?: string[];
  onStoreChange?: (store: ChatMemoryStore) => void;
};

export async function compactChatMemory(model: ModelConfig | undefined): Promise<ChatMemoryStore> {
  if (isDemoModel(model) || !model) {
    throw new Error("请先在设置中配置一个真实的模型 API，再整理长期记忆。");
  }
  const store = await loadChatMemory();
  if (store.items.length === 0) return store;
  const facts = await compactFactsWithModel(model, store.items);
  if (facts.length === 0) return store;
  return saveChatMemory({ ...store, items: replaceMemoryItemsFromFacts(facts) });
}

export function scheduleMemoryUpdateFromTurn(payload: MemoryTurnPayload) {
  const {
    model,
    sessionId,
    userText,
    assistantText,
    workspacePath,
    toolNames = [],
    onStoreChange,
  } = payload;
  if (isDemoModel(model) || !model) return;
  if (!userText.trim() || !assistantText.trim()) return;
  if (toolNames.some(isWorkspaceMemoryExcludedTool) && !hasExplicitMemoryIntent(userText)) return;

  const activeModel = model;
  void enqueueMemoryJob(async () => {
    const store = await loadChatMemory();
    if (!store.enabled) return;

    let facts: string[] = [];
    try {
      facts = await extractFactsFromTurn(
        activeModel,
        userText,
        assistantText,
        store.items,
        workspacePath,
      );
      facts = facts.filter((fact) => !isWorkspaceContextFact(fact, workspacePath));
    } catch (error) {
      console.error("Failed to extract chat memory", error);
      return;
    }

    if (facts.length === 0) return;

    let items = mergeMemoryItems(store.items, facts, { sourceSessionId: sessionId });
    if (shouldCompactMemory(items)) {
      try {
        const compacted = await compactFactsWithModel(activeModel, items);
        if (compacted.length > 0) {
          items = replaceMemoryItemsFromFacts(compacted);
        }
      } catch (error) {
        console.error("Failed to compact chat memory", error);
      }
    }

    const next = await saveChatMemory({ ...store, items });
    onStoreChange?.(next);
  });
}
