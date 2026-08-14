import { describe, expect, it } from "vitest";
import {
  extractWorkspaceToolSummary,
  resolveWorkspaceToolFileTarget,
} from "./chat-tool-call-utils";

describe("chat tool call workspace file targets", () => {
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
