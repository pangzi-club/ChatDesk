import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  deriveTitle,
  extractCreateTaskProgress,
  extractMarkdownHeadings,
  isSessionStatus,
  parseCreateTaskOutput,
  parsePlanUserInputRequest,
  parsePlanUserInputResponse,
  resolveContextCompactionThreshold,
  resolveModelContextWindow,
  resolveSessionTitle,
  sessionMatchesQuery,
  sessionSearchRelevance,
  sortPlanUserInputOptions,
  textFromMessage,
} from "./chat.ts";

describe("shared chat contracts", () => {
  it("derives a bounded title from the first user message", () => {
    const title = deriveTitle([
      {
        id: "user-1",
        role: "user",
        parts: [{ type: "text", text: "  帮我检查这个项目的构建问题  " }],
      },
    ]);
    assert.equal(title, "帮我检查这个项目的构建问题");
  });

  it("keeps a custom session title and still derives the default ones", () => {
    const messages = [
      {
        id: "user-1",
        role: "user" as const,
        parts: [{ type: "text" as const, text: "帮我检查这个项目的构建问题" }],
      },
    ];
    assert.equal(resolveSessionTitle(undefined, messages), "帮我检查这个项目的构建问题");
    assert.equal(resolveSessionTitle("新对话", messages), "帮我检查这个项目的构建问题");
    assert.equal(
      resolveSessionTitle("帮我检查这个项目的构建问题", messages),
      "帮我检查这个项目的构建问题",
    );
    assert.equal(resolveSessionTitle("修复构建失败", messages), "修复构建失败");
  });

  it("ranks session search against titles and user text without assistant or cwd noise", () => {
    const titleHit = {
      title: "成就系统",
      cwd: "/tmp/other",
      messages: [
        { id: "m1", role: "user" as const, parts: [{ type: "text" as const, text: "hello" }] },
      ],
    };
    const messageHit = {
      title: "Daily notes",
      cwd: "/tmp/other",
      messages: [
        {
          id: "m1",
          role: "user" as const,
          parts: [{ type: "text" as const, text: "讨论成就解锁" }],
        },
      ],
    };
    const workspaceOnly = {
      title: "查看依赖",
      cwd: "/Users/bohaowang/Workspace/App/niuma2",
      messages: [
        { id: "m1", role: "user" as const, parts: [{ type: "text" as const, text: "hello" }] },
      ],
    };
    const assistantOnly = {
      title: "Daily notes",
      messages: [
        {
          id: "m1",
          role: "assistant" as const,
          parts: [{ type: "text" as const, text: "搜索成就相关代码" }],
        },
      ],
    };
    assert.equal(sessionMatchesQuery(titleHit, "成就"), true);
    assert.equal(sessionMatchesQuery(messageHit, "成就"), true);
    assert.equal(sessionMatchesQuery(workspaceOnly, "niuma"), false);
    assert.equal(sessionMatchesQuery(assistantOnly, "成就"), false);
    assert.equal(sessionMatchesQuery(messageHit, "解锁 成就"), true);
    assert.ok(
      sessionSearchRelevance(titleHit, "成就") > sessionSearchRelevance(messageHit, "成就"),
    );
    assert.equal(sessionMatchesQuery(workspaceOnly, ""), true);
  });

  it("validates known session statuses", () => {
    assert.equal(isSessionStatus("streaming"), true);
    assert.equal(isSessionStatus("unknown"), false);
  });

  it("joins text parts with a configurable separator and ignores tool parts", () => {
    const message = {
      id: "assistant-1",
      role: "assistant" as const,
      parts: [
        { type: "text" as const, text: "先检查配置。" },
        {
          type: "tool-read_file" as const,
          toolCallId: "read-1",
          state: "output-available" as const,
          input: { path: "config.json" },
          output: { content: "{}" },
        },
        { type: "text" as const, text: "配置没有问题。" },
      ],
    };

    assert.equal(textFromMessage(message), "先检查配置。 配置没有问题。");
    assert.equal(textFromMessage(message, "\n"), "先检查配置。\n配置没有问题。");
  });

  it("resolves model context windows and compaction thresholds", () => {
    assert.equal(resolveModelContextWindow(undefined), DEFAULT_MODEL_CONTEXT_WINDOW);
    assert.equal(resolveModelContextWindow(256_000), 256_000);
    assert.equal(resolveContextCompactionThreshold(undefined), 96_000);
    assert.equal(resolveContextCompactionThreshold(80_000), 60_000);
    assert.equal(resolveContextCompactionThreshold(1_000_000), 750_000);
  });

  it("validates plan questions and sorts the recommended option first", () => {
    const request = parsePlanUserInputRequest({
      questions: [
        {
          id: "preview",
          header: "计划预览",
          question: "怎样展示？",
          recommendedOptionId: "rendered",
          options: [
            { id: "source", label: "源码" },
            { id: "rendered", label: "Markdown 预览", description: "更易阅读" },
          ],
        },
      ],
    });
    assert.ok(request);
    assert.deepEqual(
      sortPlanUserInputOptions(request.questions[0]).map((option) => option.id),
      ["rendered", "source"],
    );
    assert.equal(
      parsePlanUserInputRequest({
        questions: [
          {
            id: "bad",
            header: "无效",
            question: "推荐项不存在？",
            recommendedOptionId: "missing",
            options: [
              { id: "a", label: "A" },
              { id: "b", label: "B" },
            ],
          },
        ],
      }),
      null,
    );
  });

  it("validates preset and custom plan answers", () => {
    assert.deepEqual(
      parsePlanUserInputResponse({
        answers: [
          { questionId: "one", optionId: "a", answer: "选项 A", custom: false },
          { questionId: "two", answer: "手动答案", custom: true },
        ],
      }),
      {
        answers: [
          { questionId: "one", optionId: "a", answer: "选项 A", custom: false },
          { questionId: "two", answer: "手动答案", custom: true },
        ],
      },
    );
    assert.equal(
      parsePlanUserInputResponse({
        answers: [{ questionId: "one", answer: "缺少选项", custom: false }],
      }),
      null,
    );
  });

  it("parses create_task tool output", () => {
    assert.deepEqual(
      parseCreateTaskOutput({
        sessionId: "task-session-1",
        title: "调研目录结构",
        status: "running",
        preview: "正在列出文件…",
        result: "完整任务结果",
        headings: ["目录结构"],
        tools: [{ name: "read_file", detail: "README.md", pending: true }],
        messages: [{ role: "assistant", text: "正在列出文件…" }],
      }),
      {
        sessionId: "task-session-1",
        title: "调研目录结构",
        status: "running",
        preview: "正在列出文件…",
        result: "完整任务结果",
        headings: ["目录结构"],
        tools: [{ name: "read_file", detail: "README.md", pending: true }],
        messages: [{ role: "assistant", text: "正在列出文件…" }],
      },
    );
    assert.equal(
      parseCreateTaskOutput({ title: "缺少 sessionId", status: "completed", preview: "" }),
      null,
    );
    assert.equal(
      parseCreateTaskOutput({
        sessionId: "task-session-1",
        title: "调研目录结构",
        status: "unknown",
        preview: "",
      }),
      null,
    );
  });

  it("extracts markdown headings and a unique tool glance from task messages", () => {
    assert.deepEqual(
      extractMarkdownHeadings(
        ["## 结论", "很长的一段说明", "### 建议", "```", "## 代码里的标题", "```"].join("\n"),
      ),
      ["结论", "建议"],
    );
    const progress = extractCreateTaskProgress([
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_file",
            toolCallId: "read-1",
            state: "output-available",
            input: { path: "src/app.ts" },
            output: { content: "ok" },
          },
          {
            type: "tool-read_file",
            toolCallId: "read-2",
            state: "output-available",
            input: { path: "src/app.ts" },
            output: { content: "ok again" },
          },
          {
            type: "tool-bash",
            toolCallId: "bash-1",
            state: "input-available",
            input: { command: "pnpm test" },
          },
          {
            type: "text",
            text: "## 结论\n子任务写了一大段 markdown。\n## 建议\n保持概览即可。",
          },
        ],
      },
    ]);
    assert.deepEqual(progress.headings, ["结论", "建议"]);
    assert.deepEqual(progress.tools, [
      { name: "read_file", detail: "app.ts" },
      { name: "bash", detail: "pnpm test", pending: true },
    ]);
  });
});
