import { createOpenAI } from "@ai-sdk/openai";
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";
import { generateText } from "ai";

import {
  type ChatMemoryItem,
  type ChatMemoryStore,
  formatMemoryForInject,
  loadChatMemory,
  MEMORY_COMPACT_TARGET_ITEMS,
  mergeMemoryItems,
  replaceMemoryItemsFromFacts,
  saveChatMemory,
  shouldCompactMemory,
} from "@/lib/chat-memory";
import type { ModelConfig } from "@/lib/models";

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

function resolveFetch(): typeof fetch {
  return ("__TAURI_INTERNALS__" in window ? tauriFetch : window.fetch.bind(window)) as typeof fetch;
}

function resolveOpenAICompatibleBaseURL(baseUrl: string): string {
  return baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/chat\/completions$/i, "")
    .replace(/\/responses$/i, "");
}

function resolveModelId(model: ModelConfig): string {
  if (model.provider !== "深度求索 / DeepSeek") return model.name;
  const legacyNames: Record<string, string> = {
    "DeepSeek-V4 Flash": "deepseek-v4-flash",
    "DeepSeek-V4 Pro": "deepseek-v4-pro",
    "deepseek-chat": "deepseek-v4-flash",
    "deepseek-reasoner": "deepseek-v4-flash",
  };
  return legacyNames[model.name] ?? model.name;
}

function extractJsonArray(text: string): string[] {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;
  const start = candidate.indexOf("[");
  const end = candidate.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => {
        if (typeof entry === "string") return entry.trim();
        if (
          entry &&
          typeof entry === "object" &&
          typeof (entry as { content?: unknown }).content === "string"
        ) {
          return (entry as { content: string }).content.trim();
        }
        return "";
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

async function generateModelText(
  model: ModelConfig,
  system: string,
  user: string,
): Promise<string> {
  if (model.responsive) {
    const provider = createOpenAI({
      apiKey: model.apiKey,
      baseURL: resolveOpenAICompatibleBaseURL(model.baseUrl),
      fetch: resolveFetch(),
    });
    const result = await generateText({
      model: provider.responses(resolveModelId(model)),
      instructions: system,
      prompt: user,
    });
    return result.text;
  }

  const response = await resolveFetch()(model.baseUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${model.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: resolveModelId(model),
      stream: false,
      temperature: 0,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { error?: { message?: string }; message?: string };
      detail = payload.error?.message ?? payload.message ?? "";
    } catch {
      // ignore
    }
    throw new Error(
      detail
        ? `模型请求失败（${response.status}）：${detail}`
        : `模型请求失败（${response.status}）`,
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content ?? "";
}

const EXTRACT_SYSTEM = `你是用户长期记忆抽取器。根据本轮对话，只抽取值得跨会话长期保留的稳定事实（身份、偏好、项目背景、固定约束等）。
规则：
1. 一条一事，尽量短，使用中文陈述句
2. 不要抽取临时任务、一次性请求、模型回复内容本身
3. 若没有值得记忆的内容，返回空数组 []
4. 只输出 JSON 字符串数组，不要 markdown，不要解释`;

const COMPACT_SYSTEM = `你是用户长期记忆整理器。将给定记忆条目去重、合并矛盾（以更新/更具体者为准）、删除临时或无价值信息，输出更精炼的事实列表。
规则：
1. 保留稳定、可跨会话复用的事实
2. 一条一事，尽量短
3. 目标约 ${MEMORY_COMPACT_TARGET_ITEMS} 条以内
4. 只输出 JSON 字符串数组，不要 markdown，不要解释`;

const WORKSPACE_MEMORY_EXCLUDED_TOOLS = new Set([
  "list_dir",
  "search_files",
  "read_file",
  "write_file",
  "edit_file",
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
): Promise<string[]> {
  const text = await generateModelText(
    model,
    EXTRACT_SYSTEM,
    `已有记忆：\n${formatMemoryForInject(existingItems) || "(空)"}\n\n用户：\n${userText}\n\n助手：\n${assistantText}\n\n只返回尚未存在于已有记忆中的新事实；如果已有记忆需要更新，请返回更新后的完整事实，不要同时保留旧表述。`,
  );
  return extractJsonArray(text);
}

async function compactFactsWithModel(
  model: ModelConfig,
  items: ChatMemoryItem[],
): Promise<string[]> {
  const text = await generateModelText(
    model,
    COMPACT_SYSTEM,
    `现有记忆：\n${formatMemoryForInject(items) || "(空)"}`,
  );
  return extractJsonArray(text);
}

export type MemoryTurnPayload = {
  model: ModelConfig | undefined;
  sessionId: string;
  userText: string;
  assistantText: string;
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
  const { model, sessionId, userText, assistantText, toolNames = [], onStoreChange } = payload;
  if (isDemoModel(model) || !model) return;
  if (!userText.trim() || !assistantText.trim()) return;
  if (toolNames.some(isWorkspaceMemoryExcludedTool) && !hasExplicitMemoryIntent(userText)) return;

  const activeModel = model;
  void enqueueMemoryJob(async () => {
    const store = await loadChatMemory();
    if (!store.enabled) return;

    let facts: string[] = [];
    try {
      facts = await extractFactsFromTurn(activeModel, userText, assistantText, store.items);
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
