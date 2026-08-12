import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";

import { classifySandboxBoundary } from "./sandbox-boundary-reviewer.ts";

const workspace = "/tmp/chatdesk-reviewer-workspace";

describe("sandbox boundary classifier", () => {
  it("allows ordinary workspace file operations without reviewer", () => {
    const result = classifySandboxBoundary(
      { toolName: "write_file", input: { path: "src/index.ts", content: "ok" } },
      workspace,
    );
    assert.equal(result.requiresReview, false);
    assert.deepEqual(result.reasons, []);
  });

  it("flags paths outside the workspace", () => {
    const result = classifySandboxBoundary(
      { toolName: "read_file", input: { path: "../secrets.txt" } },
      workspace,
    );
    assert.equal(result.requiresReview, true);
    assert.deepEqual(result.reasons, ["external-path"]);
  });

  it("does not review read-only workspace paths that resolve through node_modules symlinks", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-reviewer-symlink-"));
    await mkdir(path.join(root, "node_modules"), { recursive: true });
    await mkdir(path.join(root, ".pnpm", "aws4fetch"), { recursive: true });
    await symlink(
      path.join(root, ".pnpm", "aws4fetch"),
      path.join(root, "node_modules", "aws4fetch"),
    );

    for (const toolName of ["list_dir", "read_file", "search_files"]) {
      const result = classifySandboxBoundary(
        { toolName, input: { path: "node_modules/aws4fetch" } },
        root,
      );
      assert.equal(result.requiresReview, false, toolName);
    }
  });

  it("flags network and external shell paths", () => {
    const result = classifySandboxBoundary(
      {
        toolName: "bash",
        input: { command: "curl https://example.com > /tmp/result.txt" },
      },
      workspace,
    );
    assert.equal(result.requiresReview, true);
    assert.deepEqual(result.reasons, ["network", "external-path"]);
  });

  it("flags read-only Bash inspection of external files", () => {
    const result = classifySandboxBoundary(
      {
        toolName: "bash",
        input: { command: "cat /Users/bohaowang/Workspace/.env" },
      },
      workspace,
    );
    assert.equal(result.requiresReview, true);
    assert.deepEqual(result.reasons, ["external-path"]);
  });

  it("flags relative paths that escape through shell redirection", () => {
    const result = classifySandboxBoundary(
      { toolName: "bash", input: { command: "echo secret > ../outside.txt" } },
      workspace,
    );
    assert.equal(result.requiresReview, true);
    assert.deepEqual(result.reasons, ["external-path"]);
  });

  it("flags shell constructs whose side effects cannot be determined safely", () => {
    const result = classifySandboxBoundary(
      {
        toolName: "bash",
        input: { command: 'node -e \'require("child_process").exec("rm -rf x")\'' },
      },
      workspace,
    );
    assert.equal(result.requiresReview, true);
    assert.deepEqual(result.reasons, ["ambiguous-shell"]);
  });

  it("ignores non-workspace tools", () => {
    const result = classifySandboxBoundary(
      { toolName: "browser_open", input: { url: "https://example.com" } },
      workspace,
    );
    assert.equal(result.requiresReview, false);
  });
});
