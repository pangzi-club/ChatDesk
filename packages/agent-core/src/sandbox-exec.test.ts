import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildSeatbeltProfile,
  classifySandboxDenial,
  isSandboxBlockedOutput,
  resolveCommandCwd,
  resolveSandboxFileProcessOutput,
  resolveSandboxWorkerCommand,
  runSandboxedFile,
  runSandboxedShell,
  SandboxPathError,
  sandboxBlockedErrorFromShell,
} from "./sandbox-exec.ts";

describe("sandbox execution errors", () => {
  it("runs a packaged sandbox worker with the shared Node runtime", () => {
    expect(
      resolveSandboxWorkerCommand(
        {
          CHAT_SERVER_PRODUCTION: "1",
          CHAT_SERVER_SANDBOX_WORKER: "/app/resources/workers/chat-server-sandbox.cjs",
        },
        "/app/node-runtime",
        () => true,
      ),
    ).toEqual({
      helperExecutable: "/app/node-runtime",
      nodeArgs: ["/app/resources/workers/chat-server-sandbox.cjs"],
      helperReadPaths: ["/app/resources/workers"],
    });
  });

  it("fails early when a production sandbox worker is missing", () => {
    expect(() =>
      resolveSandboxWorkerCommand({ CHAT_SERVER_PRODUCTION: "1" }, "/app/node-runtime"),
    ).toThrow("未配置打包的 sandbox worker");
  });

  it("uses the TypeScript helper entry during development", () => {
    expect(
      resolveSandboxWorkerCommand({}, "/usr/local/bin/node", () => false, "/repo/sandbox.ts"),
    ).toEqual({
      helperExecutable: "/usr/local/bin/node",
      nodeArgs: ["--experimental-strip-types", "/repo/sandbox.ts"],
      helperReadPaths: ["/repo"],
    });
  });

  it("only classifies recognizable Seatbelt denial output as sandbox blocked", () => {
    expect(isSandboxBlockedOutput("sandbox-exec: deny file-write-data")).toBe(true);
    expect(isSandboxBlockedOutput("sandbox-exec: sandbox_apply: Operation not permitted")).toBe(
      false,
    );
    expect(isSandboxBlockedOutput("command failed: exit status 1")).toBe(false);
    expect(isSandboxBlockedOutput("permission denied by application")).toBe(false);
  });

  it("classifies macOS dyld and DNS sandbox denials as blocked", () => {
    const xcrun =
      "xcrun: error: unable to load libxcrun (dlopen(/Applications/Xcode.app/Contents/Developer/usr/lib/libxcrun.dylib, 0x0005): tried: '/Applications/Xcode.app/Contents/Developer/usr/lib/libxcrun.dylib' (file system sandbox blocked open()))";
    const dns =
      "git2: failed to resolve address for github.com: nodename nor servname provided, or not known";
    expect(isSandboxBlockedOutput(xcrun)).toBe(true);
    expect(isSandboxBlockedOutput(dns)).toBe(true);
    expect(isSandboxBlockedOutput("Could not resolve host: github.com")).toBe(true);
    expect(
      isSandboxBlockedOutput("[ERROR] GET https://registry.npmjs.org/pnpm: fetch failed"),
    ).toBe(true);
    expect(isSandboxBlockedOutput("ERR_PNPM_META_FETCH_FAIL request failed")).toBe(true);
    expect(isSandboxBlockedOutput(dns, { allowNetwork: true })).toBe(false);
  });

  it("classifies silent curl and wget network denials as blocked", () => {
    const silentCurl =
      'echo "== repo info =="; curl -s -o /dev/null -w "%{http_code}\\n" "https://api.github.com/repos/openai/skills"';
    expect(isSandboxBlockedOutput("000", { command: silentCurl, code: 6 })).toBe(true);
    expect(classifySandboxDenial("000", { command: silentCurl, code: 6 })).toBe("network");
    expect(isSandboxBlockedOutput("", { command: "curl -s https://example.com", code: 7 })).toBe(
      true,
    );
    expect(isSandboxBlockedOutput("", { command: "wget -q https://example.com", code: 4 })).toBe(
      true,
    );
    expect(
      isSandboxBlockedOutput("000", { command: silentCurl, code: 6, allowNetwork: true }),
    ).toBe(false);
    expect(isSandboxBlockedOutput("000", { command: silentCurl, code: 6, timedOut: true })).toBe(
      false,
    );
    expect(
      isSandboxBlockedOutput("000", { command: "curl -s -f https://example.com", code: 22 }),
    ).toBe(false);
    expect(
      isSandboxBlockedOutput("JSONDecodeError: Expecting value: line 1 column 1 (char 0)", {
        command:
          'curl -s "https://api.github.com/repos/openai/skills/contents/skills/.curated" | python3 -c "import json,sys; json.load(sys.stdin)"',
        code: 1,
      }),
    ).toBe(false);
    expect(
      isSandboxBlockedOutput("Username/Password Authentication Failed.", {
        command: "wget https://example.com",
        code: 6,
      }),
    ).toBe(false);
    expect(isSandboxBlockedOutput("000", { code: 6 })).toBe(false);
    expect(isSandboxBlockedOutput("000")).toBe(false);
  });

  it("preserves a network denial kind for silent curl retry", () => {
    const error = sandboxBlockedErrorFromShell("curl -s https://api.github.com", {
      out: "000",
      code: 6,
      sandboxDenialKind: "network",
    });
    expect(error.denialKind).toBe("network");
    expect(error.message).toContain("000");
    expect(error.message).toContain("被沙箱拦截了网络访问（curl 退出码 6）");
  });

  it("does not treat ordinary command failures as sandbox denials", () => {
    expect(
      isSandboxBlockedOutput("fatal: repository 'https://github.com/org/repo.git' not found"),
    ).toBe(false);
    expect(isSandboxBlockedOutput("git: command not found")).toBe(false);
    expect(
      isSandboxBlockedOutput(
        "Cloning into 'mkagent'...\nfatal: Could not read from remote repository.",
      ),
    ).toBe(false);
    expect(isSandboxBlockedOutput("Permission denied (publickey).")).toBe(false);
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

  it("respects a structured sandbox denial from the file helper", () => {
    const result = resolveSandboxFileProcessOutput(
      JSON.stringify({ ok: false, blocked: true, error: "operation not permitted" }),
      "",
      1,
      true,
    );

    expect(result.sandboxBlocked).toBe(true);
    expect(result.error).toBe("operation not permitted");
  });

  it("preserves structured protected-path errors without classifying them as sandbox denials", () => {
    const result = resolveSandboxFileProcessOutput(
      JSON.stringify({
        ok: false,
        blocked: false,
        error: "文件工具禁止读取受保护路径：~/.ssh",
        errorCode: "protected_path",
        errorOperation: "read",
        errorRule: "~/.ssh",
      }),
      "",
      1,
      true,
    );

    expect(result).toMatchObject({
      sandboxBlocked: false,
      errorCode: "protected_path",
      errorOperation: "read",
      errorRule: "~/.ssh",
    });
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

  it("keeps tool caches outside the workspace and uses the real home", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-cache-env-"));
    const result = await runSandboxedShell(
      'printf "%s\\n%s\\n%s" "$HOME" "$npm_config_cache" "$GOCACHE"',
      { cwd: root, mode: "full" },
    );
    const [home, npmCache, goCache] = result.out.split("\n");

    expect(home).toBe(os.homedir());
    expect(npmCache).toContain(path.join(os.tmpdir(), "chatdesk-sandbox-cache"));
    expect(goCache).toContain(path.join(os.tmpdir(), "chatdesk-sandbox-cache"));
    expect(npmCache).not.toContain(root);
    expect(goCache).not.toContain(root);
    expect(existsSync(npmCache)).toBe(true);
    expect(existsSync(goCache)).toBe(true);
  });

  it("keeps running commands that exceed the output limit and returns a head-tail buffer", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-output-"));
    const command = `${JSON.stringify(process.execPath)} -e 'process.stdout.write("x".repeat(2500000))'`;
    const result = await runSandboxedShell(command, { cwd: root, mode: "full" });

    expect(result).toMatchObject({
      code: 0,
      success: true,
      timedOut: false,
      truncated: true,
      totalOutputBytes: 2_500_000,
    });
    expect(result.out).toContain("命令输出已截断");
    expect(Buffer.byteLength(result.out)).toBeLessThanOrEqual(128 * 1024);
  });

  it("reports pipeline failures through pipefail", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-pipefail-"));
    const result = await runSandboxedShell("false | tail -n 1", { cwd: root, mode: "full" });

    expect(result).toMatchObject({
      code: 1,
      out: "",
      success: false,
      timedOut: false,
      truncated: false,
      totalOutputBytes: 0,
    });
  });

  it("returns empty output for silent successful commands", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-silent-"));
    const result = await runSandboxedShell("true", { cwd: root, mode: "full" });

    expect(result).toMatchObject({
      code: 0,
      out: "",
      success: true,
      timedOut: false,
      truncated: false,
      totalOutputBytes: 0,
    });
  });

  it("marks timed out commands explicitly", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-timeout-"));
    const command = `${JSON.stringify(process.execPath)} -e 'setTimeout(() => {}, 10000)'`;
    const result = await runSandboxedShell(command, {
      cwd: root,
      mode: "full",
      timeoutMs: 50,
    });

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
    expect(result.out).toContain("命令执行超时");
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

  it("paginates large directory listings", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-list-"));
    await Promise.all(
      Array.from({ length: 1_197 }, (_, index) =>
        writeFile(path.join(root, `entry-${String(index).padStart(4, "0")}.txt`), "", "utf8"),
      ),
    );

    const first = await runSandboxedFile(
      { operation: "list_dir", workspace: root },
      { mode: "full" },
    );
    expect(first.result).toMatchObject({
      totalEntries: 1_197,
      truncated: true,
      nextOffset: 200,
    });
    expect((first.result as { entries: unknown[] }).entries).toHaveLength(200);

    const last = await runSandboxedFile(
      { operation: "list_dir", workspace: root, offset: 1_000, limit: 500 },
      { mode: "full" },
    );
    expect(last.result).toMatchObject({ totalEntries: 1_197, truncated: false });
    expect((last.result as { entries: unknown[] }).entries).toHaveLength(197);
  });

  it("terminates a running shell when its abort signal fires", async () => {
    const controller = new AbortController();
    const startedAt = Date.now();
    const resultPromise = runSandboxedShell("sleep 30", {
      cwd: process.cwd(),
      mode: "full",
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 30);
    const result = await resultPromise;

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result.success).toBe(false);
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

  it("applies multi-file patches atomically outside a Git repository", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-patch-"));
    await writeFile(path.join(root, "one.txt"), "before\n", "utf8");
    const patch = [
      "diff --git a/one.txt b/one.txt",
      "--- a/one.txt",
      "+++ b/one.txt",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      "diff --git a/two.txt b/two.txt",
      "new file mode 100644",
      "--- /dev/null",
      "+++ b/two.txt",
      "@@ -0,0 +1 @@",
      "+created",
      "",
    ].join("\n");

    const result = await runSandboxedFile(
      { operation: "apply_patch", workspace: root, patch },
      { mode: "full" },
    );

    expect(result.result).toMatchObject({
      changedFiles: ["one.txt", "two.txt"],
      stats: [
        { path: "one.txt", additions: 1, deletions: 1 },
        { path: "two.txt", additions: 1, deletions: 0 },
      ],
    });
    await expect(readFile(path.join(root, "one.txt"), "utf8")).resolves.toBe("after\n");
    await expect(readFile(path.join(root, "two.txt"), "utf8")).resolves.toBe("created\n");
  });

  it("does not modify files when a patch hunk fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-patch-fail-"));
    const target = path.join(root, "note.txt");
    await writeFile(target, "current\n", "utf8");
    const patch = [
      "diff --git a/note.txt b/note.txt",
      "--- a/note.txt",
      "+++ b/note.txt",
      "@@ -1 +1 @@",
      "-missing",
      "+changed",
      "",
    ].join("\n");

    const result = await runSandboxedFile(
      { operation: "apply_patch", workspace: root, patch },
      { mode: "full" },
    );

    expect(result.result).toBeUndefined();
    expect(result.error).toContain("patch failed");
    await expect(readFile(target, "utf8")).resolves.toBe("current\n");
  });

  it("rejects unsafe, oversized, and binary patches", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-patch-path-"));
    const traversal = [
      "diff --git a/../outside.txt b/../outside.txt",
      "--- a/../outside.txt",
      "+++ b/../outside.txt",
      "@@ -0,0 +1 @@",
      "+blocked",
      "",
    ].join("\n");
    const binary = [
      "diff --git a/image.png b/image.png",
      "new file mode 100644",
      "GIT binary patch",
      "literal 0",
      "HcmV?d00001",
      "",
    ].join("\n");
    const absolute = [
      "--- /tmp/outside.txt",
      "+++ /tmp/outside.txt",
      "@@ -0,0 +1 @@",
      "+blocked",
      "",
    ].join("\n");
    const gitMetadata = [
      "diff --git a/.git/config b/.git/config",
      "--- a/.git/config",
      "+++ b/.git/config",
      "@@ -0,0 +1 @@",
      "+blocked",
      "",
    ].join("\n");
    const oversized = `${traversal}${"x".repeat(256 * 1024)}`;

    for (const patch of [traversal, absolute, gitMetadata, oversized, binary]) {
      const result = await runSandboxedFile(
        { operation: "apply_patch", workspace: root, patch },
        { mode: "full" },
      );
      expect(result.result).toBeUndefined();
    }
  });

  it("bounds edit mismatch diagnostics and identifies whitespace-only candidates", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "chatdesk-sandbox-edit-diagnostic-"));
    const target = path.join(root, "note.txt");
    await writeFile(target, `${"padding\n".repeat(10_000)}const value =  1;\n`, "utf8");
    const result = await runSandboxedFile(
      {
        operation: "edit_file",
        workspace: root,
        path: target,
        oldText: "const value = 1;",
        newText: "const value = 2;",
      },
      { mode: "full" },
    );

    expect(result.result).toBeUndefined();
    expect(result.error).toContain("第 10001 行（仅空白不同）");
    expect(Buffer.byteLength(result.error ?? "")).toBeLessThanOrEqual(2 * 1024);
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
