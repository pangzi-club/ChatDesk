import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "vitest";
import { SandboxBlockedError } from "./sandbox-exec.ts";
import {
  createWorkspaceTools,
  resolveApprovedBashPermissions,
  resolveBashRetryPermissions,
  type WorkspaceToolPreflight,
} from "./workspace-tools.ts";

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
  it("exposes Git through Bash instead of a dedicated tool", () => {
    const tools = createWorkspaceTools("/tmp/workspace", "full");
    assert.equal("git" in tools, false);
    assert.equal(typeof tools.bash.execute, "function");
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

  it("keeps filesystem and network retry permissions separate", () => {
    const clone = { command: "git clone git@github.com:MkThingsHQ/mkagent.git" };
    assert.deepEqual(
      resolveBashRetryPermissions(
        clone,
        "/tmp/workspace",
        [],
        new SandboxBlockedError("file system sandbox blocked open()"),
      ),
      { allowOutside: true, allowNetwork: false },
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
    assert.deepEqual(
      resolveBashRetryPermissions(
        { command: "pnpm install > /tmp/pnpm.log" },
        "/tmp/workspace",
        [],
        new SandboxBlockedError("ERR_PNPM_META_FETCH_FAIL fetch failed"),
      ),
      { allowOutside: false, allowNetwork: true },
    );
    assert.deepEqual(
      resolveBashRetryPermissions(
        {
          command:
            'curl -s -o /dev/null -w "%{http_code}" https://api.github.com/repos/openai/skills',
        },
        "/tmp/workspace",
        [],
        new SandboxBlockedError("000", "network"),
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

describe("DeepSeek-compatible workspace tool inputs", () => {
  it("accepts file_path with offset/limit and rejects conflicting path aliases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-tools-"));
    await writeFile(path.join(root, "sample.txt"), "one\ntwo\nthree\nfour", "utf8");
    const tools = createWorkspaceTools(root, "full");
    const execute = tools.read_file.execute;
    if (typeof execute !== "function") throw new Error("read_file execute missing");
    const output = (await execute(
      { file_path: "sample.txt", offset: 2, limit: 2 },
      {} as Parameters<typeof execute>[1],
    )) as { content: string; startLine: number; endLine: number };
    assert.deepEqual(
      { content: output.content, startLine: output.startLine, endLine: output.endLine },
      { content: "two\nthree", startLine: 2, endLine: 3 },
    );
    await assert.rejects(() =>
      execute({ path: "sample.txt", file_path: "other.txt" }, {} as Parameters<typeof execute>[1]),
    );
  });

  it("accepts file_text, replace_all, and insert_line aliases", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-tools-"));
    const tools = createWorkspaceTools(root, "full");
    const write = tools.write_file.execute;
    const edit = tools.edit_file.execute;
    if (typeof write !== "function" || typeof edit !== "function") {
      throw new Error("write/edit execute missing");
    }
    await write(
      { file_path: "sample.txt", file_text: "alpha\nalpha" },
      {} as Parameters<typeof write>[1],
    );
    await edit(
      {
        file_path: "sample.txt",
        old_string: "alpha",
        new_string: "beta",
        replace_all: true,
      },
      {} as Parameters<typeof edit>[1],
    );
    await edit(
      { file_path: "sample.txt", insert_line: 1, new_str: "inserted" },
      {} as Parameters<typeof edit>[1],
    );
    assert.equal(await readFile(path.join(root, "sample.txt"), "utf8"), "beta\ninserted\nbeta");
  });

  it("supports include filters, regular expressions, and Bash workdir", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-tools-"));
    await writeFile(path.join(root, "sample.ts"), "const value42 = true;", "utf8");
    await writeFile(path.join(root, "sample.txt"), "const value42 = true;", "utf8");
    const tools = createWorkspaceTools(root, "full");
    const search = tools.search_files.execute;
    const bash = tools.bash.execute;
    if (typeof search !== "function" || typeof bash !== "function") {
      throw new Error("search/bash execute missing");
    }
    const result = (await search(
      { query: "value[0-9]+", regex: true, include: "*.ts" },
      {} as Parameters<typeof search>[1],
    )) as { matches: string[] };
    assert.deepEqual(result.matches, ["sample.ts"]);
    const bashResult = (await bash(
      { command: "pwd", workdir: ".", timeoutMs: 5_000, description: "Print working directory" },
      {} as Parameters<typeof bash>[1],
    )) as { code: number; out: string };
    assert.equal(bashResult.code, 0);
    assert.equal(bashResult.out.trim(), await realpath(root));
  });
});
