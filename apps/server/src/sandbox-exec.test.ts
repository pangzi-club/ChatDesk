import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSeatbeltProfile,
  isSandboxBlockedOutput,
  resolveCommandCwd,
  runSandboxedRead,
  runSandboxedShell,
  SandboxPathError,
} from "./sandbox-exec.ts";

describe("sandbox execution errors", () => {
  it("only classifies recognizable Seatbelt denial output as sandbox blocked", () => {
    expect(isSandboxBlockedOutput("sandbox-exec: deny file-write-data")).toBe(true);
    expect(isSandboxBlockedOutput("sandbox-exec: sandbox_apply: Operation not permitted")).toBe(
      false,
    );
    expect(isSandboxBlockedOutput("command failed: exit status 1")).toBe(false);
    expect(isSandboxBlockedOutput("permission denied by application")).toBe(false);
  });

  it("uses a stable error code for invalid boundary paths", () => {
    expect(() => resolveCommandCwd("/tmp", "/etc", "ask")).toThrow(SandboxPathError);
    try {
      resolveCommandCwd("/tmp", "/etc", "ask");
    } catch (error) {
      expect(error).toMatchObject({
        code: "sandbox_path_invalid",
        message: "Bash cwd 必须是 workspace 内的相对路径或 workspace 内的绝对路径",
      });
    }
  });

  it("rejects a workspace symlink that resolves outside the workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-cwd-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-outside-"));
    await symlink(outside, path.join(root, "linked"));

    expect(() => resolveCommandCwd(root, "linked", "ask")).toThrow(SandboxPathError);
  });

  it("does not expose server credentials to shell commands", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-env-"));
    const previous = process.env.CHAT_SERVER_TOKEN;
    process.env.CHAT_SERVER_TOKEN = "test-secret-token";
    try {
      const result = await runSandboxedShell('printf "%s" "$CHAT_SERVER_TOKEN"', {
        cwd: root,
        mode: "full",
      });
      expect(result.out).not.toContain("test-secret-token");
    } finally {
      if (previous === undefined) delete process.env.CHAT_SERVER_TOKEN;
      else process.env.CHAT_SERVER_TOKEN = previous;
    }
  });

  it("terminates commands that exceed the output limit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-output-"));
    const command = `${JSON.stringify(process.execPath)} -e 'process.stdout.write("x".repeat(2500000))'`;
    const result = await runSandboxedShell(command, { cwd: root, mode: "full" });

    expect(result.out).toContain("命令输出超过限制");
  });

  it("adds configured paths to the read policy without adding them to writable paths", () => {
    const profile = buildSeatbeltProfile("/tmp/workspace", ["/tmp/read-only"]);
    expect(profile).toContain('(subpath "/tmp/read-only")');
    expect(profile).toContain("(deny default)");
    expect(profile).toContain('(allow file-read* (subpath "/tmp/read-only"))');
    expect(profile).toContain('(allow file-write* (subpath "/tmp/workspace"))');
    expect(profile).not.toContain("require-not");
  });

  it("runs structured read operations in the helper process", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-read-"));
    await mkdir(path.join(root, "node_modules", "aws4fetch"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "aws4fetch", "README.md"), "aws4fetch", "utf8");

    const file = await runSandboxedRead(
      { operation: "read_file", workspace: root, path: "node_modules/aws4fetch/README.md" },
      { mode: "full" },
    );
    expect(file.sandboxBlocked).toBe(false);
    expect(file.result).toMatchObject({ content: "aws4fetch" });

    const directory = await runSandboxedRead(
      { operation: "list_dir", workspace: root, path: "node_modules/aws4fetch" },
      { mode: "full" },
    );
    expect(directory.sandboxBlocked).toBe(false);
    expect(directory.result).toMatchObject({ entries: [{ name: "README.md" }] });

    const search = await runSandboxedRead(
      { operation: "search_files", workspace: root, query: "aws4fetch" },
      { mode: "full" },
    );
    expect(search.result).toMatchObject({ matches: [] });
  });
});
