import { describe, expect, it } from "vitest";
import {
  type ChatToolCallCardProps,
  getChatToolGroupStatus,
  getChatToolGroupSummary,
  getChatToolRunningSummary,
} from "./chat-tool-call-card";
import {
  extractWorkspaceToolSummary,
  resolveWorkspaceToolFileTarget,
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

  it("summarizes repeated calls with the tool name and total count", () => {
    expect(
      getChatToolGroupSummary([
        toolCall({ input: { path: "a.ts" } }),
        toolCall({ input: { path: "b.ts" } }),
        toolCall({ input: { path: "c.ts" } }),
      ]),
    ).toBe("读取文件");
  });

  it("summarizes mixed calls using distinct tool names instead of the last call", () => {
    expect(
      getChatToolGroupSummary([
        toolCall({ toolName: "search_files" }),
        toolCall({ toolName: "read_file" }),
        toolCall({ toolName: "bash" }),
      ]),
    ).toBe("搜索文件、读取文件等");
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
  });

  it("describes a running call as an active action", () => {
    expect(
      getChatToolRunningSummary(
        toolCall({ state: "input-streaming", input: { path: "package.json" } }),
      ),
    ).toBe("正在读取文件 · package.json");
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

  it("keeps long edit_file paths intact in the summary", () => {
    const path = "/Users/bohaowang/Workspace/App/m-dashboard/package.json";

    expect(extractWorkspaceToolSummary("edit_file", { path }, { path, changed: true })).toBe(
      ` · ${path}`,
    );
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
