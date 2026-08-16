import { type ServerModelConfig, textFromMessage } from "@chatdesk/shared";
import type { UIMessage } from "ai";

export const SESSION_TITLE_MAX_CHARS = 40;
export const SESSION_TITLE_MAX_OUTPUT_TOKENS = 256;
export const SESSION_TITLE_REASONING_MAX_OUTPUT_TOKENS = 2048;
const PROMPT_MESSAGE_LIMIT = 30;
const PROMPT_TEXT_LIMIT = 24_000;

export const SESSION_TITLE_SYSTEM =
  "You write a concise conversation title. Return exactly one line of at most 40 characters in the same language as the conversation. Do not use quotes, trailing punctuation, markdown, or explanations.";

export function hasUserMessageText(messages: UIMessage[]) {
  return messages.some((message) => message.role === "user" && textFromMessage(message).trim());
}

export function buildSessionTitlePrompt(messages: UIMessage[]) {
  const excerpts = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .flatMap((message) => {
      const text = textFromMessage(message).replace(/\s+/g, " ").trim();
      if (!text) return [];
      const role = message.role === "user" ? "User" : "Assistant";
      return [`${role}: ${text}`];
    })
    .slice(-PROMPT_MESSAGE_LIMIT);
  return `Write a short title for this conversation:\n\n${excerpts.join("\n").slice(0, PROMPT_TEXT_LIMIT)}`;
}

export function normalizeGeneratedSessionTitle(value: string) {
  const firstLine = value
    .trim()
    .replace(/^```(?:\w+)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .split(/\r?\n/, 1)[0]
    ?.trim()
    .replace(/^['"“”‘’「」『』《》]+|['"“”‘’「」『』《》]+$/g, "")
    .replace(/[。！？.!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!firstLine) return "";
  const chars = Array.from(firstLine);
  return chars.slice(0, SESSION_TITLE_MAX_CHARS).join("");
}

export function sessionTitleMaxOutputTokens(
  model: Pick<ServerModelConfig, "responsive" | "supportsReasoning">,
) {
  return model.responsive || model.supportsReasoning
    ? SESSION_TITLE_REASONING_MAX_OUTPUT_TOKENS
    : SESSION_TITLE_MAX_OUTPUT_TOKENS;
}

export function resolveSessionTitleModel(
  config: { models: unknown[]; apiKeys: Record<string, string> },
  preferredModelId?: string,
): ServerModelConfig | undefined {
  const models = config.models.filter((item): item is Record<string, unknown> =>
    Boolean(item && typeof item === "object"),
  );
  const match = (id?: string) =>
    id ? models.find((item) => item.id === id || item.name === id) : undefined;
  const candidate =
    match(preferredModelId) ?? models.find((item) => item.isDefault === true) ?? models[0];
  if (!candidate) return undefined;
  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const baseUrl = typeof candidate.baseUrl === "string" ? candidate.baseUrl.trim() : "";
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : name;
  const apiKey =
    (typeof candidate.apiKey === "string" ? candidate.apiKey : "") ||
    config.apiKeys[id] ||
    config.apiKeys[name];
  if (!name || !baseUrl || !apiKey) return undefined;
  return {
    id,
    name,
    baseUrl,
    apiKey,
    provider: typeof candidate.provider === "string" ? candidate.provider : undefined,
    responsive: candidate.responsive === true,
    supportsReasoning: candidate.supportsReasoning === true,
  };
}
