import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  DEFAULT_MODEL_CONTEXT_WINDOW,
  deriveTitle,
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
        messages: [{ role: "assistant", text: "正在列出文件…" }],
      }),
      {
        sessionId: "task-session-1",
        title: "调研目录结构",
        status: "running",
        preview: "正在列出文件…",
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
});
