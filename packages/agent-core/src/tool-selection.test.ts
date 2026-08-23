import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  hasWorkspace,
  selectPlanWorkspaceToolNames,
  selectWorkspaceToolNames,
  workspaceSearchInstructions,
} from "./tool-selection.ts";

describe("workspace tool selection", () => {
  it("requires a non-empty workspace path", () => {
    assert.equal(hasWorkspace(undefined), false);
    assert.equal(hasWorkspace("   "), false);
    assert.equal(hasWorkspace("/tmp/workspace"), true);
  });

  it("keeps file tools when terminal is selected through its pack alias", () => {
    assert.deepEqual(selectWorkspaceToolNames(["terminal", "read_file", "edit_file"]), [
      "read_file",
      "edit_file",
      "apply_patch",
      "bash",
    ]);
  });

  it("returns only explicitly requested workspace tools", () => {
    assert.deepEqual(selectWorkspaceToolNames(["read_file", "web_search"]), ["read_file"]);
  });

  it("keeps plan mode read-only even when write tools are selected", () => {
    assert.deepEqual(
      selectPlanWorkspaceToolNames(["list_dir", "read_file", "write_file", "edit_file", "bash"]),
      ["list_dir", "read_file"],
    );
  });

  it("only requires the dedicated search tool when it is actually available", () => {
    assert.match(
      workspaceSearchInstructions(["search_files", "terminal"]),
      /优先使用 search_files/,
    );
    assert.doesNotMatch(workspaceSearchInstructions(["search_files", "terminal"]), /可通过 Bash/);
    assert.match(workspaceSearchInstructions(["terminal"]), /可通过 Bash 使用 rg/);
    assert.equal(workspaceSearchInstructions(["read_file"]), "");
  });
});
