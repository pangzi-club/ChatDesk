import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { resolveApprovedBashPermissions } from "./workspace-tools.ts";

describe("workspace bash approval permissions", () => {
  it("keeps network-only approvals inside the filesystem sandbox", () => {
    assert.deepEqual(
      resolveApprovedBashPermissions({ command: "pnpm install" }, "/tmp/workspace", [], true),
      { allowOutside: false, allowNetwork: true },
    );
  });

  it("does not grant full access for ambiguous shell commands", () => {
    assert.deepEqual(
      resolveApprovedBashPermissions(
        { command: "node -e 'console.log(\"ok\")'" },
        "/tmp/workspace",
        [],
        true,
      ),
      { allowOutside: false, allowNetwork: false },
    );
  });

  it("only allows filesystem escape for approved external paths", () => {
    assert.deepEqual(
      resolveApprovedBashPermissions(
        { command: "cat /Users/example/project/file" },
        "/tmp/workspace",
        [],
        true,
      ),
      { allowOutside: true, allowNetwork: false },
    );
  });
});
