import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  type ChatToolCallCardProps,
  ChatToolCallGroup,
  getChatToolGroupStatus,
  getChatToolGroupSummary,
  getChatToolRunningSummary,
  getChatToolSummary,
} from "./chat-tool-call-card";
import {
  extractBrowserToolDetail,
  extractWorkspaceToolSummary,
  getToolCallInputFields,
  getToolCallOutputFields,
  headlineToolText,
  previewToolText,
  resolveWorkspaceToolFileTarget,
  TOOL_SUMMARY_MAX_CHARS,
} from "./chat-tool-call-utils";

function toolCall(overrides: Partial<ChatToolCallCardProps> = {}): ChatToolCallCardProps {
  return {
    toolName: "read_file",
    state: "output-available",
    ...overrides,
  };
}

describe("chat tool call group summaries", () => {
  it("shows the single call summary unchanged", () => {
    expect(
      getChatToolGroupSummary([
        toolCall({ toolName: "read_file", input: { path: "package.json" } }),
      ]),
    ).toContain("读取文件");
  });

  it("shows the last repeated call in the summary", () => {
    expect(
      getChatToolGroupSummary([
        toolCall({ input: { path: "a.ts" } }),
        toolCall({ input: { path: "b.ts" } }),
        toolCall({ input: { path: "c.ts" } }),
      ]),
    ).toBe("读取文件 · c.ts");
  });

  it("shows the last mixed call instead of aggregating tool names", () => {
    expect(
      getChatToolGroupSummary([
        toolCall({ toolName: "search_files" }),
        toolCall({ toolName: "read_file" }),
        toolCall({ toolName: "bash", input: { command: "pnpm check" } }),
      ]),
    ).toBe("终端 · Bash · pnpm check");
  });

  it("truncates a long last bash command in the group summary", () => {
    const command =
      "pnpm exec biome format apps/desktop/src/components/chat-tool-call-card.tsx apps/desktop/src/App.css && pnpm check";
    expect(
      getChatToolGroupSummary([
        toolCall({ input: { path: "a.ts" } }),
        toolCall({ toolName: "bash", input: { command } }),
      ]),
    ).toMatch(/^终端 · Bash · pnpm exec biome format.+…$/);
  });

  it("aggregates status across the group instead of trusting the last call", () => {
    expect(
      getChatToolGroupStatus([
        toolCall({ state: "output-error", errorText: "failed" }),
        toolCall({ state: "output-available" }),
      ]),
    ).toBe("已完成");
    expect(
      getChatToolGroupStatus([
        toolCall({ state: "output-available" }),
        toolCall({ state: "input-streaming" }),
      ]),
    ).toBe("执行中");
    expect(
      getChatToolGroupStatus([
        toolCall({ toolName: "bash", output: { code: 1, success: false, out: "failed" } }),
      ]),
    ).toBe("失败");
  });

  it("describes a running call as an active action", () => {
    expect(
      getChatToolRunningSummary(
        toolCall({ state: "input-streaming", input: { path: "package.json" } }),
      ),
    ).toBe("正在读取文件 · package.json");
  });

  it("omits completed status and call count from the active group summary", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatToolCallGroup, {
        active: true,
        calls: [toolCall({ input: { path: "a.ts" } }), toolCall({ input: { path: "b.ts" } })],
      }),
    );

    expect(markup).toContain("chat-tool-call-group is-active");
    expect(markup).not.toContain("已完成");
    expect(markup).not.toContain("2 次");
  });

  it("renders a single tool call without an extra group wrapper", () => {
    const markup = renderToStaticMarkup(
      createElement(ChatToolCallGroup, {
        active: true,
        calls: [toolCall({ toolName: "bash", input: { command: "pnpm check" } })],
      }),
    );

    expect(markup).toContain("chat-tool-call");
    expect(markup).not.toContain("chat-tool-call-group");
    expect(markup).toContain("终端 · Bash");
    expect(markup).toContain("pnpm check");
  });
});

describe("chat tool call workspace file targets", () => {
  it("shows only the final path segment for directory listings and file reads", () => {
    expect(
      extractWorkspaceToolSummary("list_dir", { path: "apps/desktop/src/components/" }, {}),
    ).toBe(" · components");
    expect(
      extractWorkspaceToolSummary(
        "read_file",
        { path: "apps/desktop/src/components/chat-tool-call-card.tsx" },
        {},
      ),
    ).toBe(" · chat-tool-call-card.tsx");
  });

  it("omits truncation metadata from tool summaries", () => {
    expect(
      extractWorkspaceToolSummary("read_file", { path: "src/index.ts" }, { truncated: true }),
    ).toBe(" · index.ts");
  });

  it("keeps file names in edit and write summaries instead of full paths", () => {
    const path = "/Users/bohaowang/Workspace/App/m-dashboard/package.json";

    expect(extractWorkspaceToolSummary("edit_file", { path }, { path, changed: true })).toBe(
      " · package.json",
    );
    expect(extractWorkspaceToolSummary("write_file", { path, content: "name: chatdesk" }, {})).toBe(
      " · package.json",
    );
  });

  it("summarizes apply_patch by changed file count", () => {
    expect(
      extractWorkspaceToolSummary(
        "apply_patch",
        { patch: "diff --git a/a b/a" },
        { changedFiles: ["a.ts", "b.ts"] },
      ),
    ).toBe(" · 2 个文件");
    expect(getToolCallInputFields("apply_patch", { patch: "diff --git a/a b/a" })).toEqual([
      { kind: "code", label: "补丁", text: "diff --git a/a b/a" },
    ]);
  });

  it("uses the first line of a bash command and truncates long summaries", () => {
    expect(
      extractWorkspaceToolSummary("bash", { command: "pnpm check\npnpm test --coverage" }, {}),
    ).toBe(" · pnpm check");

    const command =
      "pnpm exec biome format apps/desktop/src/components/chat-tool-call-card.tsx apps/desktop/src/App.css && pnpm check";
    const summary = extractWorkspaceToolSummary("bash", { command }, { code: 0, out: "ok" });
    expect(summary.startsWith(" · pnpm exec biome format")).toBe(true);
    expect(summary.endsWith("…")).toBe(true);
    expect(summary.length).toBeLessThanOrEqual(TOOL_SUMMARY_MAX_CHARS + 3);
    expect(summary).not.toContain("exit");
  });

  it("previews long tool body text without keeping the full payload in the collapsed view", () => {
    expect(previewToolText("short output")).toEqual({ text: "short output", truncated: false });
    expect(previewToolText(Array.from({ length: 50 }, () => "line").join("\n")).truncated).toBe(
      true,
    );
    expect(previewToolText("a".repeat(3000)).truncated).toBe(true);
  });

  it("renders bash parameters as the command instead of a JSON wrapper", () => {
    expect(getToolCallInputFields("bash", { command: "echo hi", cwd: "/tmp" })).toEqual([
      { kind: "meta", label: "目录", text: "/tmp" },
      { kind: "code", label: "命令", text: "echo hi", tone: "command" },
    ]);
    expect(
      getToolCallOutputFields("bash", {
        code: 0,
        out: "hi\n",
        success: true,
        timedOut: false,
        truncated: true,
        totalOutputBytes: 131_200,
      }),
    ).toEqual([
      { kind: "meta", label: "状态", text: "成功" },
      { kind: "meta", label: "退出码", text: "0" },
      { kind: "meta", label: "输出截断", text: "是" },
      { kind: "meta", label: "输出字节", text: "131,200" },
      { kind: "code", label: "输出", text: "hi\n", tone: "output" },
    ]);
  });

  it("summarizes browser tools with a truncated primary argument", () => {
    expect(extractBrowserToolDetail("browser_open", { url: "https://example.com/docs" })).toBe(
      "https://example.com/docs",
    );
    expect(
      getChatToolSummary(
        toolCall({
          toolName: "browser_eval",
          input: { expression: `document.body.innerHTML = "${"x".repeat(120)}";` },
        }),
      ),
    ).toContain("…");
    expect(headlineToolText("first line\nsecond line")).toBe("first line");
  });

  it("resolves editable workspace tools as openable file targets", () => {
    const path = "apps/desktop/src/components/chat-tool-call-card.tsx";

    expect(resolveWorkspaceToolFileTarget("edit_file", { path }, { path, changed: true })).toEqual({
      path,
    });
    expect(resolveWorkspaceToolFileTarget("write_file", { path }, { path, bytes: 42 })).toEqual({
      path,
    });
  });

  it("preserves read_file content for immediate viewer rendering", () => {
    expect(
      resolveWorkspaceToolFileTarget(
        "read_file",
        { path: "package.json" },
        { path: "package.json", content: '{"name":"chatdesk"}' },
      ),
    ).toEqual({
      path: "package.json",
      content: '{"name":"chatdesk"}',
    });
  });

  it("does not treat directory, search, or shell tools as single file targets", () => {
    expect(resolveWorkspaceToolFileTarget("list_dir", { path: "." }, { path: "." })).toBeNull();
    expect(
      resolveWorkspaceToolFileTarget("search_files", { query: "package" }, { matches: [] }),
    ).toBeNull();
    expect(resolveWorkspaceToolFileTarget("bash", { command: "cat package.json" }, {})).toBeNull();
  });
});
