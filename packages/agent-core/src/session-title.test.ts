import assert from "node:assert/strict";
import type { UIMessage } from "ai";
import { test } from "vitest";
import {
  buildSessionTitlePrompt,
  hasUserMessageText,
  normalizeGeneratedSessionTitle,
  resolveSessionTitleModel,
  SESSION_TITLE_MAX_CHARS,
  SESSION_TITLE_MAX_OUTPUT_TOKENS,
  SESSION_TITLE_REASONING_MAX_OUTPUT_TOKENS,
  sessionTitleMaxOutputTokens,
} from "./session-title.ts";

function message(role: "user" | "assistant", text: string): UIMessage {
  return { id: `${role}-${text}`, role, parts: [{ type: "text", text }] };
}

test("detects user text and builds a bounded prompt from recent turns", () => {
  assert.equal(hasUserMessageText([]), false);
  assert.equal(hasUserMessageText([message("assistant", "hi")]), false);
  assert.equal(hasUserMessageText([message("user", "  检查构建  ")]), true);

  const prompt = buildSessionTitlePrompt([
    message("user", "帮我检查这个项目的构建问题"),
    message("assistant", "先看 package.json"),
  ]);
  assert.match(prompt, /User: 帮我检查这个项目的构建问题/);
  assert.match(prompt, /Assistant: 先看 package.json/);
});

test("normalizes generated titles and returns empty when the model produced no text", () => {
  assert.equal(normalizeGeneratedSessionTitle('"修复构建失败"'), "修复构建失败");
  assert.equal(normalizeGeneratedSessionTitle("```text\n修复构建失败。\n```"), "修复构建失败");
  assert.equal(normalizeGeneratedSessionTitle("第一行标题\n第二行解释"), "第一行标题");
  assert.equal(
    normalizeGeneratedSessionTitle("A".repeat(SESSION_TITLE_MAX_CHARS + 10)),
    "A".repeat(SESSION_TITLE_MAX_CHARS),
  );
  assert.equal(normalizeGeneratedSessionTitle("   "), "");
});

test("gives reasoning and Responses models a larger title-generation budget", () => {
  assert.equal(sessionTitleMaxOutputTokens({}), SESSION_TITLE_MAX_OUTPUT_TOKENS);
  assert.equal(
    sessionTitleMaxOutputTokens({ responsive: true }),
    SESSION_TITLE_REASONING_MAX_OUTPUT_TOKENS,
  );
  assert.equal(
    sessionTitleMaxOutputTokens({ supportsReasoning: true }),
    SESSION_TITLE_REASONING_MAX_OUTPUT_TOKENS,
  );
});

test("resolves a preferred or default helper model only when credentials exist", () => {
  const models = [
    {
      id: "fast",
      name: "fast-model",
      baseUrl: "https://example.com/v1",
      isDefault: true,
    },
    {
      id: "chat",
      name: "chat-model",
      baseUrl: "https://example.com/v1",
    },
  ];
  assert.equal(resolveSessionTitleModel({ models, apiKeys: {} }), undefined);
  assert.equal(resolveSessionTitleModel({ models, apiKeys: { fast: "fast-key" } })?.id, "fast");
  assert.equal(
    resolveSessionTitleModel({ models, apiKeys: { chat: "chat-key", fast: "fast-key" } }, "chat")
      ?.id,
    "chat",
  );
});
