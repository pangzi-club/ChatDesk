import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, it } from "vitest";
import { SandboxBlockedError } from "./sandbox-exec.ts";
import {
  createWorkspaceTools,
  resolveApprovedBashPermissions,
  resolveBashRetryPermissions,
  type WorkspaceToolPreflight,
} from "./workspace-tools.ts";

const execFileAsync = promisify(execFile);

function bashExecute(
  preflight: WorkspaceToolPreflight,
  onSandboxBlocked: () => Promise<{ approved: boolean; reason?: string }>,
) {
  const tools = createWorkspaceTools(
    "/tmp/workspace",
    "auto",
    new Set(),
    onSandboxBlocked,
    [],
    new Map([["call_1", preflight]]),
  );
  const execute = tools.bash.execute;
  assert(typeof execute === "function");
  return (command: string) =>
    execute({ command }, { toolCallId: "call_1" } as Parameters<typeof execute>[1]);
}

describe("workspace bash approval permissions", () => {
  it("creates a branch and commits through the controlled git tool", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-workspace-git-tool-"));
    try {
      await execFileAsync("git", ["init", "-q", "-b", "main"], { cwd: root });
      await execFileAsync("git", ["config", "user.email", "test@example.com"], { cwd: root });
      await execFileAsync("git", ["config", "user.name", "Test"], { cwd: root });
      await writeFile(path.join(root, "note.txt"), "before\n", "utf8");
      await execFileAsync("git", ["add", "."], { cwd: root });
      await execFileAsync("git", ["commit", "-q", "-m", "initial"], { cwd: root });

      const tools = createWorkspaceTools(root, "full");
      const execute = tools.git.execute;
      assert(typeof execute === "function");
      await execute(
        { action: "create_branch", branch: "feature/chat-git" },
        {} as Parameters<typeof execute>[1],
      );
      await writeFile(path.join(root, "note.txt"), "after\n", "utf8");
      const result = await execute(
        { action: "commit", message: "update note" },
        {} as Parameters<typeof execute>[1],
      );

      assert.equal(result.action, "commit");
      assert.match(result.hash, /^[0-9a-f]{40}$/);
      assert.equal(await readFile(path.join(root, "note.txt"), "utf8"), "after\n");
      assert.equal(
        (await execFileAsync("git", ["branch", "--show-current"], { cwd: root })).stdout.trim(),
        "feature/chat-git",
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

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

  it("retries xcrun denials with filesystem escape and git clone with network", () => {
    const clone = { command: "git clone git@github.com:MkThingsHQ/mkagent.git" };
    assert.deepEqual(
      resolveBashRetryPermissions(
        clone,
        "/tmp/workspace",
        [],
        new SandboxBlockedError("file system sandbox blocked open()"),
      ),
      { allowOutside: true, allowNetwork: true },
    );
    assert.deepEqual(
      resolveBashRetryPermissions(
        clone,
        "/tmp/workspace",
        [],
        new SandboxBlockedError(
          "git2: failed to resolve address for github.com: nodename nor servname provided, or not known",
        ),
      ),
      { allowOutside: false, allowNetwork: true },
    );
  });

  it("escalates a sandbox-blocked bash preflight instead of returning it as a normal failure", async () => {
    let reviewed = false;
    const execute = bashExecute(
      {
        status: "sandbox-blocked",
        error: new SandboxBlockedError("file system sandbox blocked open()"),
      },
      async () => {
        reviewed = true;
        return { approved: false, reason: "denied for test" };
      },
    );
    await assert.rejects(
      () => execute("git clone git@github.com:MkThingsHQ/mkagent.git"),
      (caught: unknown) => {
        assert.equal(caught instanceof SandboxBlockedError, true);
        assert.equal((caught as SandboxBlockedError).message, "denied for test");
        return true;
      },
    );
    assert.equal(reviewed, true);
  });

  it("does not ask the reviewer when bash preflight fails with an ordinary command error", async () => {
    let reviewed = false;
    const execute = bashExecute(
      { status: "error", error: new Error("fatal: repository not found") },
      async () => {
        reviewed = true;
        return { approved: true };
      },
    );
    await assert.rejects(
      () => execute("git clone git@github.com:MkThingsHQ/mkagent.git"),
      (caught: unknown) => {
        assert.equal(caught instanceof Error, true);
        assert.equal((caught as Error).message, "fatal: repository not found");
        assert.equal(caught instanceof SandboxBlockedError, false);
        return true;
      },
    );
    assert.equal(reviewed, false);
  });

  it("returns a successful preflight command failure without reviewer", async () => {
    let reviewed = false;
    const execute = bashExecute(
      {
        status: "ok",
        result: {
          code: 1,
          out: "fatal: repository 'https://github.com/org/repo.git' not found",
          sandboxBlocked: false,
        },
      },
      async () => {
        reviewed = true;
        return { approved: true };
      },
    );
    assert.deepEqual(await execute("git clone https://github.com/org/repo.git"), {
      code: 1,
      out: "fatal: repository 'https://github.com/org/repo.git' not found",
      sandboxBlocked: false,
    });
    assert.equal(reviewed, false);
  });
});
