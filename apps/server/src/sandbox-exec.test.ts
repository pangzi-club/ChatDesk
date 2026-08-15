import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSeatbeltProfile,
  isSandboxBlockedOutput,
  resolveCommandCwd,
  resolveSandboxFileProcessOutput,
  runSandboxedFile,
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

  it("does not classify successful file content as a sandbox denial", () => {
    const stdout = JSON.stringify({
      ok: true,
      result: {
        path: "chat.tsx",
        content: "CHAT_SANDBOX_MODE_DESCRIPTIONS\nconst action = 'Deny';",
      },
    });

    const result = resolveSandboxFileProcessOutput(stdout, "", 0, true);

    expect(isSandboxBlockedOutput(stdout)).toBe(true);
    expect(result.sandboxBlocked).toBe(false);
    expect(result.result).toMatchObject({ path: "chat.tsx" });
  });

  it("still classifies unstructured Seatbelt stderr as sandbox blocked", () => {
    const result = resolveSandboxFileProcessOutput(
      "",
      "sandbox-exec: deny file-read-data",
      1,
      true,
    );

    expect(result.sandboxBlocked).toBe(true);
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

  it("keeps tool caches outside the workspace without exposing the real home", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-cache-env-"));
    const result = await runSandboxedShell(
      'printf "%s\\n%s\\n%s" "$HOME" "$npm_config_cache" "$GOCACHE"',
      { cwd: root, mode: "full" },
    );
    const [home, npmCache, goCache] = result.out.split("\n");

    expect(home).toContain(path.join(os.tmpdir(), "chatdesk-sandbox-cache-"));
    expect(home).not.toBe(os.homedir());
    expect(home).not.toContain(root);
    expect(npmCache).toContain(path.join(os.tmpdir(), "chatdesk-sandbox-cache-"));
    expect(goCache).toContain(path.join(os.tmpdir(), "chatdesk-sandbox-cache-"));
    expect(npmCache).not.toContain(root);
    expect(goCache).not.toContain(root);
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

  it("allows only explicitly requested extra write targets", () => {
    const profile = buildSeatbeltProfile("/tmp/workspace", [], [], ["/opt/chatdesk-approved.txt"]);
    expect(profile).toContain('(allow file-write* (literal "/opt/chatdesk-approved.txt"))');
    expect(profile).not.toContain('(allow file-write* (subpath "/opt"))');
  });

  it("adds developer tool installs as read-only roots and keeps network permission separate", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-tool-workspace-"));
    const runtime = await mkdtemp(path.join(process.cwd(), ".chatdesk-tool-runtime-"));
    const bin = path.join(runtime, "bin");
    try {
      await mkdir(bin, { recursive: true });
      await writeFile(path.join(bin, "node"), "#!/bin/sh\n", "utf8");
      await chmod(path.join(bin, "node"), 0o755);

      const profile = buildSeatbeltProfile(root, [], [], [], [bin], true);

      expect(profile).toContain(`(allow file-read* (subpath "${runtime}"))`);
      expect(profile).toContain("(allow network*)");
      expect(profile).toContain(`(allow file-write* (subpath "${root}"))`);
      expect(profile).not.toContain(`(allow file-write* (subpath "${runtime}"))`);
    } finally {
      await rm(runtime, { recursive: true });
    }
  });

  it("prepends configured developer directories to the shell PATH", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-tool-path-"));
    const bin = path.join(root, "tools");
    await mkdir(bin);
    await writeFile(path.join(bin, "node"), "#!/bin/sh\n", "utf8");
    await chmod(path.join(bin, "node"), 0o755);
    await writeFile(path.join(bin, "chatdesk-test-tool"), "#!/bin/sh\nprintf tool-ready\n", "utf8");
    await chmod(path.join(bin, "chatdesk-test-tool"), 0o755);

    const result = await runSandboxedShell("chatdesk-test-tool", {
      cwd: root,
      mode: "full",
      developerToolPaths: [bin],
    });

    expect(result.code).toBe(0);
    expect(result.out).toContain("tool-ready");
  });

  it("runs structured read operations in the helper process", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-read-"));
    await mkdir(path.join(root, "node_modules", "aws4fetch"), { recursive: true });
    await writeFile(path.join(root, "node_modules", "aws4fetch", "README.md"), "aws4fetch", "utf8");

    const file = await runSandboxedFile(
      { operation: "read_file", workspace: root, path: "node_modules/aws4fetch/README.md" },
      { mode: "full" },
    );
    expect(file.sandboxBlocked).toBe(false);
    expect(file.result).toMatchObject({ content: "aws4fetch" });

    const directory = await runSandboxedFile(
      { operation: "list_dir", workspace: root, path: "node_modules/aws4fetch" },
      { mode: "full" },
    );
    expect(directory.sandboxBlocked).toBe(false);
    expect(directory.result).toMatchObject({ entries: [{ name: "README.md" }] });

    const search = await runSandboxedFile(
      { operation: "search_files", workspace: root, query: "aws4fetch" },
      { mode: "full" },
    );
    expect(search.result).toMatchObject({ matches: [] });
  });

  it("runs structured writes in the helper process", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-write-"));
    const target = path.join(root, "note.txt");
    const write = await runSandboxedFile(
      { operation: "write_file", workspace: root, path: target, content: "before\n" },
      { mode: "full" },
    );
    expect(write.sandboxBlocked).toBe(false);
    expect(write.result).toMatchObject({ path: "note.txt", bytes: 7 });

    const edit = await runSandboxedFile(
      {
        operation: "edit_file",
        workspace: root,
        path: target,
        oldText: "before",
        newText: "after",
      },
      { mode: "full" },
    );
    expect(edit.sandboxBlocked).toBe(false);
    expect(edit.result).toMatchObject({ path: "note.txt", changed: true });
    await expect(readFile(target, "utf8")).resolves.toBe("after\n");
  });

  it("rejects helper writes outside the workspace", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-write-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-write-outside-"));
    const result = await runSandboxedFile(
      {
        operation: "write_file",
        workspace: root,
        path: path.join(outside, "blocked.txt"),
        content: "no",
      },
      { mode: "full" },
    );
    expect(result.sandboxBlocked).toBe(false);
    expect(result.result).toBeUndefined();
    expect(result.error).toContain("写入路径必须位于 workspace 内");
  });
});
