import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { selectWorkspaceToolNames } from "./tool-selection.ts";

describe("workspace tool selection", () => {
  it("keeps file tools when terminal is selected through its pack alias", () => {
    assert.deepEqual(
      selectWorkspaceToolNames(["terminal", "read_file", "edit_file"]),
      ["read_file", "edit_file", "bash"],
    );
  });

  it("returns only explicitly requested workspace tools", () => {
    assert.deepEqual(selectWorkspaceToolNames(["read_file", "web_search"]), ["read_file"]);
  });
});
