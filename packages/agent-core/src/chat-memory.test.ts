import assert from "node:assert/strict";
import { test } from "vitest";
import {
  buildMemoryCompactPrompt,
  buildMemoryExtractPrompt,
  MEMORY_COMPACT_SYSTEM,
  MEMORY_COMPACT_TARGET_ITEMS,
  parseMemoryFacts,
} from "./chat-memory.ts";

test("parses plain, fenced, and object-shaped fact arrays", () => {
  assert.deepEqual(parseMemoryFacts('["偏好中文回答", "使用 pnpm"]'), [
    "偏好中文回答",
    "使用 pnpm",
  ]);
  assert.deepEqual(parseMemoryFacts('```json\n["偏好中文回答"]\n```'), ["偏好中文回答"]);
  assert.deepEqual(parseMemoryFacts('[{"content": " 偏好中文回答 "}]'), ["偏好中文回答"]);
  assert.deepEqual(parseMemoryFacts('这是结果：["偏好中文回答"]，请查收。'), ["偏好中文回答"]);
});

test("returns no facts for empty or malformed model output", () => {
  assert.deepEqual(parseMemoryFacts(""), []);
  assert.deepEqual(parseMemoryFacts("没有可记忆的内容"), []);
  assert.deepEqual(parseMemoryFacts("[]"), []);
  assert.deepEqual(parseMemoryFacts('["ok", {"other": 1}, 3]'), ["ok"]);
});

test("builds the extraction prompt with existing memory and the current turn", () => {
  const prompt = buildMemoryExtractPrompt({
    items: ["偏好中文回答"],
    workspacePath: "/tmp/project",
    userText: "记住我用 pnpm",
    assistantText: "好的",
  });
  assert.match(prompt, /- 偏好中文回答/);
  assert.match(prompt, /当前会话 workspace：\/tmp\/project/);
  assert.match(prompt, /用户：\n记住我用 pnpm/);
  assert.match(prompt, /助手：\n好的/);
});

test("builds the compaction prompt and keeps the target item budget in the system prompt", () => {
  assert.match(buildMemoryCompactPrompt([]), /\(空\)/);
  const prompt = buildMemoryCompactPrompt(["第一条", "第二条"]);
  assert.match(prompt, /- 第一条/);
  assert.match(prompt, /- 第二条/);
  assert.match(MEMORY_COMPACT_SYSTEM, new RegExp(String(MEMORY_COMPACT_TARGET_ITEMS)));
});
